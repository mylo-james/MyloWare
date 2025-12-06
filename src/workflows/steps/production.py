"""Production step - generates video clips from ideas."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict
from uuid import UUID

from langfuse import observe
from llama_stack_client import LlamaStackClient

from agents.factory import create_agent
from client import extract_content
from config import settings
from config.projects import load_project
from storage.models import ArtifactType, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.helpers import check_video_cache, extract_trace_id, notify_telegram
from workflows.parsers import extract_topic_from_brief, parse_structured_ideation
from workflows.state import WorkflowResult
from workflows.steps.base import BaseStep, StepContext

logger = logging.getLogger(__name__)


class ProductionStep(BaseStep):
    """Generate video clips using producer agent and KIE.ai."""
    
    @property
    def name(self) -> str:
        return "producer"
    
    @observe()
    def execute(self, context: StepContext) -> WorkflowResult:
        """Execute production step.
        
        Checks cache for existing videos, then calls producer agent
        to generate new clips via KIE.ai. Pauses at AWAITING_VIDEO_GENERATION
        until webhooks arrive.
        """
        run = context.run_repo.get(context.run_id)
        if run is None:
            return WorkflowResult.failure(str(context.run_id), f"Run {context.run_id} not found")
        
        artifacts = run.artifacts or {}
        ideas_text = artifacts.get("ideas", "")
        
        # Count ideas to determine clip count
        idea_count = self._count_ideas(ideas_text, run.workflow_name)
        
        # Extract topic and signs for caching
        topic = extract_topic_from_brief(run.input) if run.input else ""
        signs = self._get_zodiac_signs(run.workflow_name)
        
        # Get structured ideation for metadata
        structured_ideation = artifacts.get("ideas_structured")
        if not structured_ideation and ideas_text:
            structured_ideation = parse_structured_ideation(ideas_text)
        
        sign_to_object = self._build_sign_mapping(structured_ideation)
        
        # Check cache first
        cache_result = self._try_cache(
            context, run, topic, signs, idea_count, sign_to_object
        )
        if cache_result is not None:
            return cache_result
        
        # Run producer agent
        try:
            return self._run_producer(
                context, run, ideas_text, idea_count, topic, signs
            )
        except Exception as exc:
            logger.exception("Production failed for run %s: %s", context.run_id, exc)
            context.run_repo.update(
                context.run_id,
                status=RunStatus.FAILED.value,
                error=str(exc),
            )
            context.run_repo.session.commit()
            return WorkflowResult.failure(str(context.run_id), str(exc))
    
    def _count_ideas(self, ideas_text: str, workflow_name: str) -> int:
        """Count number of ideas in the text."""
        count = ideas_text.count("**Idea") or ideas_text.count("Idea 1")
        if count == 0:
            count = ideas_text.count("###")
        if count == 0:
            count = 2 if workflow_name != "aismr" else 12
        return count
    
    def _get_zodiac_signs(self, workflow_name: str) -> list[str] | None:
        """Get zodiac signs from project config."""
        if workflow_name != "aismr":
            return None
        try:
            project = load_project(workflow_name)
            zodiac_data = project.get("zodiac_signs", [])
            return [z["sign"] for z in zodiac_data]
        except Exception:
            return None
    
    def _build_sign_mapping(self, structured: Dict | None) -> Dict[str, Dict]:
        """Build sign -> object mapping from structured ideation."""
        mapping = {}
        if structured and "ideas" in structured:
            for idea in structured["ideas"]:
                mapping[idea.get("sign", "")] = {
                    "object": idea.get("object", ""),
                    "visual": idea.get("visual", ""),
                }
        return mapping
    
    def _try_cache(
        self,
        context: StepContext,
        run: Any,
        topic: str,
        signs: list[str] | None,
        idea_count: int,
        sign_to_object: Dict[str, Dict],
    ) -> WorkflowResult | None:
        """Try to use cached videos. Returns None if cache miss."""
        if not settings.use_video_cache or not topic:
            return None
        
        cached_urls, missing_signs = check_video_cache(
            context.artifact_repo, topic, signs, required_count=idea_count
        )
        
        if not cached_urls or len(cached_urls) < idea_count or missing_signs:
            return None
        
        # All videos cached - skip producer
        logger.info(
            "All %d videos found in cache for topic '%s' - skipping producer",
            len(cached_urls),
            topic,
        )
        
        zodiac_order = signs or [
            "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
            "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
        ]
        
        for idx, url in enumerate(cached_urls[:idea_count]):
            sign = zodiac_order[idx] if idx < len(zodiac_order) else ""
            object_data = sign_to_object.get(sign, {})
            object_name = object_data.get("object", sign)
            
            context.artifact_repo.create(
                run_id=context.run_id,
                persona=self.name,
                artifact_type=ArtifactType.VIDEO_CLIP,
                uri=url,
                metadata={
                    "video_index": idx,
                    "source": "cache",
                    "topic": topic,
                    "sign": sign,
                    "object_name": object_name,
                },
            )
        
        context.artifact_repo.create(
            run_id=context.run_id,
            persona=self.name,
            artifact_type=ArtifactType.CLIP_MANIFEST,
            content=json.dumps({"cached": True, "count": idea_count, "topic": topic}),
            metadata={"task_count": idea_count, "step": self.name, "from_cache": True},
        )
        
        context.run_repo.add_artifact(
            context.run_id, "script", f"[Loaded {idea_count} videos from cache]"
        )
        context.run_repo.update(context.run_id, status=RunStatus.AWAITING_RENDER.value)
        context.run_repo.session.commit()
        
        # Trigger async continuation to editor
        self._trigger_editor_async(context.run_id)
        
        return WorkflowResult(
            run_id=str(context.run_id),
            status=RunStatus.AWAITING_RENDER.value,
            artifacts=run.artifacts or {},
            current_step="producer (cached)",
        )
    
    def _trigger_editor_async(self, run_id: UUID) -> None:
        """Trigger async continuation to editor step."""
        from workflows.steps.editing import continue_to_editor
        
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(continue_to_editor(run_id))
        except RuntimeError:
            asyncio.run(continue_to_editor(run_id))
    
    def _run_producer(
        self,
        context: StepContext,
        run: Any,
        ideas_text: str,
        idea_count: int,
        topic: str,
        signs: list[str] | None,
    ) -> WorkflowResult:
        """Run producer agent to generate video clips."""
        producer = create_agent(
            context.client,
            run.workflow_name,
            "producer",
            context.vector_db_id,
            run_id=context.run_id,
        )
        session_id = producer.create_session(f"run-{context.run_id}-producer")
        
        # Build cache hint
        cache_hint = ""
        if settings.cache_new_videos and topic:
            cache_hint = f"\n\nIMPORTANT: Include cache metadata in each video: topic='{topic}'"
            if signs:
                cache_hint += ", sign='<corresponding zodiac sign>'"
        
        producer_response = producer.create_turn(
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Generate exactly {idea_count} video clips based on these ideas:\n\n"
                        f"{ideas_text}\n\n"
                        f"Call kie_generate with exactly {idea_count} prompts.{cache_hint}"
                    ),
                }
            ],
            session_id=session_id,
        )
        
        script = extract_content(producer_response)
        artifacts = run.artifacts or {}
        artifacts["script"] = script
        
        context.run_repo.add_artifact(context.run_id, "script", script)
        context.artifact_repo.create(
            run_id=context.run_id,
            persona=self.name,
            artifact_type=ArtifactType.SCRIPT,
            content=script,
            metadata={"step": self.name, "topic": topic},
            trace_id=extract_trace_id(producer_response),
        )
        
        context.artifact_repo.create(
            run_id=context.run_id,
            persona=self.name,
            artifact_type=ArtifactType.CLIP_MANIFEST,
            content="Clips submitted to KIE.ai",
            metadata={"task_count": idea_count, "step": self.name, "topic": topic},
        )
        
        # Wait for KIE.ai webhooks
        context.run_repo.update(
            context.run_id,
            status=RunStatus.AWAITING_VIDEO_GENERATION.value,
        )
        context.run_repo.session.commit()
        
        logger.info(
            "Producer submitted %d clips to KIE.ai for run %s",
            idea_count,
            context.run_id,
        )
        
        return WorkflowResult(
            run_id=str(context.run_id),
            status=RunStatus.AWAITING_VIDEO_GENERATION.value,
            artifacts=artifacts,
            current_step=self.name,
        )


def run_production(
    client: LlamaStackClient,
    run_id: UUID,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    vector_db_id: str | None = None,
    notifier: Any = None,
) -> WorkflowResult:
    """Convenience function to run production step after ideation approval."""
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
    
    step = ProductionStep()
    result = step.execute(context)
    
    if result.is_failed:
        notify_telegram(run, notifier, "failed", error=result.error, step="producer")
    
    return result

