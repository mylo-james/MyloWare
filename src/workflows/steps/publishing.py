"""Publishing step - publishes video to social platforms."""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from langfuse import observe
from llama_stack_client import LlamaStackClient

from agents.factory import create_agent
from client import extract_content
from storage.models import ArtifactType, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.helpers import extract_trace_id, notify_telegram
from workflows.state import WorkflowResult
from workflows.steps.base import BaseStep, StepContext

logger = logging.getLogger(__name__)


class PublishingStep(BaseStep):
    """Publish rendered video to social platforms using publisher agent."""
    
    @property
    def name(self) -> str:
        return "publisher"
    
    @observe()
    def execute(self, context: StepContext) -> WorkflowResult:
        """Execute publishing step.
        
        Gets video URL from artifacts and publishes using publisher agent.
        Marks workflow as COMPLETED on success.
        """
        run = context.run_repo.get(context.run_id)
        if run is None:
            return WorkflowResult.failure(str(context.run_id), f"Run {context.run_id} not found")
        
        try:
            artifacts = run.artifacts or {}
            
            # Get video URL
            video_url = self._get_video_url(context, artifacts)
            if not video_url:
                raise ValueError("No video URL found for publishing")
            
            # Get topic from structured ideation
            topic = self._extract_topic(artifacts)
            
            # Create publisher agent
            publisher = create_agent(
                context.client,
                run.workflow_name,
                "publisher",
                context.vector_db_id,
                run_id=context.run_id,
            )
            publisher_session = publisher.create_session(f"run-{context.run_id}-publisher")
            
            # Build publisher message
            publisher_message = self._build_publisher_message(
                run.workflow_name, video_url, topic
            )
            
            publisher_response = publisher.create_turn(
                messages=[{"role": "user", "content": publisher_message}],
                session_id=publisher_session,
            )
            
            publish_result = extract_content(publisher_response)
            artifacts["publish_result"] = publish_result
            
            context.run_repo.add_artifact(context.run_id, "publish_result", publish_result)
            context.artifact_repo.create(
                run_id=context.run_id,
                persona=self.name,
                artifact_type=ArtifactType.PUBLISHED_URL,
                content=publish_result,
                metadata={"step": self.name},
                trace_id=extract_trace_id(publisher_response),
            )
            
            # Mark as completed
            context.run_repo.update(context.run_id, status=RunStatus.COMPLETED.value)
            context.run_repo.session.commit()
            
            logger.info("Publishing complete for run %s", context.run_id)
            
            return WorkflowResult(
                run_id=str(context.run_id),
                status=RunStatus.COMPLETED.value,
                artifacts=artifacts,
                current_step=self.name,
            )
            
        except Exception as exc:
            logger.exception("Publishing failed for run %s: %s", context.run_id, exc)
            context.run_repo.update(
                context.run_id,
                status=RunStatus.FAILED.value,
                error=str(exc),
            )
            context.run_repo.session.commit()
            return WorkflowResult.failure(str(context.run_id), str(exc))
    
    def _get_video_url(self, context: StepContext, artifacts: dict) -> str | None:
        """Get video URL from artifacts."""
        video_url = artifacts.get("video", "")
        if video_url:
            return video_url
        
        # Look up from artifact table
        all_artifacts = context.artifact_repo.get_by_run(context.run_id)
        rendered = next(
            (a for a in all_artifacts 
             if a.artifact_type == ArtifactType.RENDERED_VIDEO.value and a.uri),
            None
        )
        if rendered:
            logger.info("Found video URL from artifact table: %s", rendered.uri)
            return rendered.uri
        
        return None
    
    def _extract_topic(self, artifacts: dict) -> str:
        """Extract topic from structured ideation."""
        structured = artifacts.get("ideas_structured")
        if isinstance(structured, dict):
            return structured.get("topic", "video")
        elif isinstance(structured, str):
            try:
                parsed = json.loads(structured)
                return parsed.get("topic", "video")
            except Exception:
                pass
        return "video"
    
    def _build_publisher_message(
        self,
        workflow_name: str,
        video_url: str,
        topic: str,
    ) -> str:
        """Build message for publisher agent."""
        if workflow_name == "aismr":
            return (
                f"PUBLISH NOW. Call upload_post with:\n\n"
                f"video_url: {video_url}\n"
                f"caption: Your month your {topic} 🌙✨\n"
                f"tags: zodiac, astrology, asmr, {topic}, satisfying, fyp\n"
                f"account_id: AISMR\n\n"
                f"Do NOT verify the URL. Just call upload_post immediately."
            )
        else:
            return f"""Publish this video:

VIDEO URL: {video_url}

Topic: {topic}
"""


def run_publishing(
    client: LlamaStackClient,
    run_id: UUID,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    vector_db_id: str | None = None,
    notifier: Any = None,
) -> WorkflowResult:
    """Convenience function to run publishing step after publish approval."""
    run = run_repo.get(run_id)
    if run is None:
        return WorkflowResult.failure(str(run_id), f"Run {run_id} not found")
    
    context = StepContext(
        run_id=run_id,
        client=client,
        run_repo=run_repo,
        artifact_repo=artifact_repo,
        project=run.workflow_name,
        brief=run.input or "",
        vector_db_id=vector_db_id or f"project_kb_{run.workflow_name}",
    )
    
    step = PublishingStep()
    result = step.execute(context)
    
    if result.is_success:
        notify_telegram(run, notifier, "completed", artifacts=result.artifacts)
    elif result.is_failed:
        notify_telegram(run, notifier, "failed", error=result.error, step="publisher")
    
    return result

