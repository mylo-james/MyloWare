"""Editing step - composes video clips into final video."""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from langfuse import observe

from agents.factory import create_agent
from client import extract_content
from storage.models import ArtifactType, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.helpers import extract_trace_id
from workflows.state import WorkflowResult
from workflows.steps.base import BaseStep, StepContext

logger = logging.getLogger(__name__)


class EditingStep(BaseStep):
    """Compose video clips into final video using editor agent and Remotion."""
    
    @property
    def name(self) -> str:
        return "editor"
    
    @observe()
    def execute(self, context: StepContext) -> WorkflowResult:
        """Execute editing step.
        
        Collects video clips from KIE.ai webhooks, composes them using
        Remotion, and pauses at AWAITING_RENDER until Remotion webhook arrives.
        """
        run = context.run_repo.get(context.run_id)
        if run is None:
            return WorkflowResult.failure(str(context.run_id), f"Run {context.run_id} not found")
        
        try:
            # Get video clips from artifacts
            all_artifacts = context.artifact_repo.get_by_run(context.run_id)
            video_clips = [
                a for a in all_artifacts
                if a.artifact_type == ArtifactType.VIDEO_CLIP.value
            ]
            
            if not video_clips:
                raise ValueError("No video clips available for editor")
            
            # Build clip data with metadata
            clips_data = self._build_clips_data(video_clips)
            clip_urls = [c["url"] for c in clips_data]
            object_names = [c["object_name"] or c["sign"] for c in clips_data]
            
            logger.info(
                "Editor received %d video clips for run %s",
                len(video_clips),
                context.run_id,
            )
            
            # Get duration from project config
            duration_seconds = self._get_duration(run.workflow_name)
            
            # Create editor agent
            editor = create_agent(
                context.client,
                run.workflow_name,
                "editor",
                context.vector_db_id,
                run_id=context.run_id,
            )
            editor_session = editor.create_session(f"run-{context.run_id}-editor")
            
            # Build message for editor
            artifacts = run.artifacts or {}
            creative_direction = artifacts.get("script") or artifacts.get("ideas") or ""
            
            editor_message = self._build_editor_message(
                run.workflow_name,
                clip_urls,
                object_names,
                creative_direction,
                duration_seconds,
            )
            
            editor_response = editor.create_turn(
                messages=[{"role": "user", "content": editor_message}],
                session_id=editor_session,
            )
            
            video = extract_content(editor_response)
            artifacts["video"] = video
            
            context.run_repo.add_artifact(context.run_id, "video", video)
            context.artifact_repo.create(
                run_id=context.run_id,
                persona=self.name,
                artifact_type=ArtifactType.RENDERED_VIDEO,
                content=video,
                metadata={"step": self.name},
                trace_id=extract_trace_id(editor_response),
            )
            
            # Wait for Remotion webhook
            context.run_repo.update(
                context.run_id,
                status=RunStatus.AWAITING_RENDER.value,
            )
            context.run_repo.session.commit()
            
            logger.info("Editor complete, waiting for Remotion webhook: %s", context.run_id)
            
            return WorkflowResult(
                run_id=str(context.run_id),
                status=RunStatus.AWAITING_RENDER.value,
                artifacts=artifacts,
                current_step=self.name,
            )
            
        except Exception as exc:
            logger.exception("Editing failed for run %s: %s", context.run_id, exc)
            context.run_repo.update(
                context.run_id,
                status=RunStatus.FAILED.value,
                error=str(exc),
            )
            context.run_repo.session.commit()
            return WorkflowResult.failure(str(context.run_id), str(exc))
    
    def _build_clips_data(self, video_clips: list) -> list[dict]:
        """Build structured clip data from artifacts."""
        clips_data = []
        for clip in video_clips:
            if clip.uri:
                meta = clip.artifact_metadata or {}
                clips_data.append({
                    "url": clip.uri,
                    "sign": meta.get("sign", ""),
                    "object_name": meta.get("object_name", ""),
                    "index": meta.get("video_index", len(clips_data)),
                })
        clips_data.sort(key=lambda x: x["index"])
        return clips_data
    
    def _get_duration(self, workflow_name: str) -> int:
        """Get video duration from project config."""
        try:
            from config.loaders import load_project_config
            project_dict = load_project_config(workflow_name)
            specs = project_dict.get("specs", {})
            return specs.get("compilation_length", 30)
        except Exception:
            return 30
    
    def _build_editor_message(
        self,
        workflow_name: str,
        clip_urls: list[str],
        object_names: list[str],
        creative_direction: str,
        duration_seconds: int,
    ) -> str:
        """Build message for editor agent."""
        clips_content = json.dumps(clip_urls, indent=2)
        objects_content = json.dumps(object_names, indent=2)
        
        if workflow_name == "aismr":
            return (
                f"Render a zodiac ASMR video with the 'aismr' template.\n\n"
                f"## CLIPS (use these EXACT URLs):\n{clips_content}\n\n"
                f"## OBJECTS (use these EXACT names - NOT zodiac signs!):\n{objects_content}\n\n"
                f"CRITICAL: The 'objects' parameter must contain the creative object names above "
                f"(like 'Flame Spirit', 'Earth Golem'), NOT zodiac sign names!\n\n"
                f"Call remotion_render with EXACTLY:\n"
                f"- template: 'aismr'\n"
                f"- clips: {clips_content}\n"
                f"- objects: {objects_content}\n"
                f"- duration_seconds: {duration_seconds}\n"
                f"- fps: 30\n"
                f"- aspect_ratio: '9:16'"
            )
        else:
            return (
                f"You have {len(clip_urls)} video clips to compose:\n"
                f"{clips_content}\n\n"
                f"Creative direction/ideation:\n{creative_direction}\n\n"
                f"IMPORTANT: Call remotion_render tool with:\n"
                f"- composition_code: your TSX (NO import statements - they are added automatically)\n"
                f"- clips: the video URLs array above\n"
                f"- duration_seconds: {duration_seconds}\n"
                f"- fps: 30\n"
                f"- aspect_ratio: '9:16'\n\n"
                "DO NOT just output code - you MUST call the remotion_render tool!"
            )


async def continue_to_editor(run_id: UUID) -> WorkflowResult:
    """Continue workflow to editor step after KIE.ai webhooks complete.
    
    Called by KIE.ai webhook handler when all video clips are ready.
    """
    from api.dependencies import get_llama_client
    from storage.database import get_session
    
    with get_session() as session:
        run_repo = RunRepository(session)
        artifact_repo = ArtifactRepository(session)
        
        run = run_repo.get(run_id)
        if run is None:
            return WorkflowResult.failure(str(run_id), f"Run {run_id} not found")
        
        client = get_llama_client()
        vector_db_id = f"project_kb_{run.workflow_name}"
        
        context = StepContext(
            run_id=run_id,
            client=client,
            run_repo=run_repo,
            artifact_repo=artifact_repo,
            project=run.workflow_name,
            brief=run.input or "",
            vector_db_id=vector_db_id,
        )
        
        step = EditingStep()
        return step.execute(context)

