"""KIE.ai video generation tool using Veo3.

This tool integrates with KIE.ai's Veo3 API to generate video clips from text prompts.
It's used by the Producer agent to create video content with voice over and foley.

Architecture:
- Tool is created per-run with run_id baked in
- Callback URL is built automatically from WEBHOOK_BASE_URL + run_id
- KIE.ai POSTs to callback when videos are ready
- Webhook handler updates run status and stores video URLs

API Docs: https://docs.kie.ai/veo3-api/quickstart
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List
from uuid import UUID

import httpx

from config import settings
from storage.database import get_session
from storage.models import ArtifactType
from storage.repositories import ArtifactRepository
from tools.base import (
    MylowareBaseTool,
    ToolParamDefinition,
    format_tool_success,
)

logger = logging.getLogger(__name__)

__all__ = ["KIEGenerationTool"]

# KIE.ai Veo3 API endpoint
VEO3_GENERATE_URL = "https://api.kie.ai/api/v1/veo/generate"


class KIEGenerationTool(MylowareBaseTool):
    """Generate video clips using KIE.ai Veo3 with voice over and foley.
    
    Tool is created per-run with run_id for webhook correlation.
    Callback URL is automatically built from environment config.
    """

    def __init__(
        self,
        run_id: str | None = None,
        api_key: str | None = None,
        model: str = "veo3_fast",
        timeout: float = 60.0,
        use_fake: bool | None = None,
    ):
        """Initialize KIE tool with run context.
        
        Args:
            run_id: Run ID for webhook callback correlation (from factory)
            api_key: KIE.ai API key (defaults to settings)
            model: Veo3 model variant (default: veo3_fast)
            timeout: HTTP timeout
            use_fake: Override fake provider setting
        """
        self.run_id = run_id
        self.api_key = api_key or getattr(settings, "kie_api_key", None)
        self.model = model
        self.timeout = timeout
        
        # Build callback URL from environment
        webhook_base = getattr(settings, "webhook_base_url", "")
        if webhook_base and run_id:
            self.callback_url = f"{webhook_base}/v1/webhooks/kieai?run_id={run_id}"
        else:
            self.callback_url = None
        
        if use_fake is None:
            self.use_fake = getattr(settings, "use_fake_providers", False)
        else:
            self.use_fake = use_fake
            
        if not self.use_fake and not self.api_key:
            raise ValueError("KIE API key required when not using fake providers")
            
        if not self.use_fake and not self.callback_url:
            raise ValueError(
                "WEBHOOK_BASE_URL and run_id required for KIE.ai webhook callbacks. "
                "Set WEBHOOK_BASE_URL in .env (e.g., https://myloware.fly.dev)"
            )
            
        logger.info(
            "KIEGenerationTool initialized (run_id=%s, fake=%s, callback=%s)",
            self.run_id,
            self.use_fake,
            bool(self.callback_url),
        )

    def _store_task_metadata(self, task_metadata: Dict[str, Dict[str, Any]]) -> None:
        """Store task_id -> cache metadata mapping in database for webhook lookup.
        
        KIE.ai doesn't return custom metadata in callbacks, so we store it here
        and look it up when webhooks arrive to populate cache fields.
        """
        if not self.run_id:
            logger.warning("Cannot store task metadata: no run_id")
            return
            
        try:
            import json
            with get_session() as session:
                repo = ArtifactRepository(session)
                repo.create(
                    run_id=UUID(self.run_id),
                    persona="producer",
                    artifact_type=ArtifactType.CLIP_MANIFEST,
                    content=json.dumps(task_metadata),
                    metadata={
                        "type": "task_metadata_mapping",
                        "task_count": len(task_metadata),
                    },
                )
                session.commit()
            logger.info("Stored task metadata mapping for %d tasks", len(task_metadata))
        except Exception as e:
            logger.error("Failed to store task metadata: %s", e)

    def get_name(self) -> str:
        return "kie_generate"

    def get_description(self) -> str:
        return (
            "Generate video clips with voice over using KIE.ai Veo3. "
            "Each video includes visual content, voice over narration, and foley/ambient sound. "
            "Provide a visual prompt and voice over script for each clip. "
            "Videos take 1-3 minutes to generate. Results delivered via webhook."
        )

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "videos": ToolParamDefinition(
                param_type="list",
                description=(
                    "List of video specifications. Each video is a dict with 'visual_prompt' (required), "
                    "'voice_over' (optional script), and optional cache metadata: 'topic', 'sign', 'object_name'."
                ),
                required=True,
            ),
            "aspect_ratio": ToolParamDefinition(
                param_type="str",
                description="Aspect ratio: '16:9', '9:16' (TikTok), '1:1'. Default: 9:16",
                required=False,
                default="9:16",
            ),
        }

    def run_impl(
        self,
        videos: List[Dict[str, str]] | None = None,
        prompts: List[str] | None = None,  # Legacy support
        aspect_ratio: str = "9:16",
        **kwargs,
    ) -> Dict[str, Any]:
        """Submit video generation jobs to KIE.ai Veo3.
        
        Args:
            videos: List of {"visual_prompt": str, "voice_over": str} dicts
            prompts: Legacy - list of visual prompts (no voice over)
            aspect_ratio: Video aspect ratio
        """
        # Handle legacy prompts parameter
        if videos is None and prompts is not None:
            videos = [{"visual_prompt": p} for p in prompts]
        
        if not videos:
            raise ValueError("Either 'videos' or 'prompts' parameter required")
        
        logger.info(
            "Submitting %s video generation jobs (model=%s, run_id=%s)",
            len(videos),
            self.model,
            self.run_id,
        )

        if self.use_fake:
            return self._run_fake(videos, aspect_ratio)
        return self._run_real(videos, aspect_ratio)

    def _run_fake(
        self,
        videos: List[Dict[str, str]],
        aspect_ratio: str,
    ) -> Dict[str, Any]:
        """Return fake results for testing."""
        task_ids = [f"fake-veo3-task-{i}" for i in range(len(videos))]
        
        logger.info("Fake KIE Veo3: Submitted %s fake tasks", len(task_ids))
        return format_tool_success(
            {
                "task_ids": task_ids,
                "status": "submitted",
                "model": self.model,
                "task_count": len(task_ids),
                "run_id": self.run_id,
                "fake_mode": True,
                "message": "Videos will be delivered via webhook when ready",
            },
            message=f"Submitted {len(task_ids)} Veo3 video generation tasks",
        )

    def _run_real(
        self,
        videos: List[Dict[str, str]],
        aspect_ratio: str,
    ) -> Dict[str, Any]:
        """Submit real jobs to KIE.ai Veo3 API.
        
        Attempts all videos and collects errors. Returns partial successes
        with error details if some fail.
        
        Returns task_metadata dict mapping task_id -> cache metadata for webhook lookup.
        """
        task_ids: List[str] = []
        task_metadata: Dict[str, Dict[str, Any]] = {}  # For webhook lookup
        errors: List[str] = []

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=self.timeout) as client:
            for idx, video in enumerate(videos):
                visual_prompt = video.get("visual_prompt", "")
                voice_over = video.get("voice_over", "")
                
                # Combine visual prompt with voice over instruction
                if voice_over:
                    full_prompt = f"{visual_prompt}\n\nVoice over narration: \"{voice_over}\""
                else:
                    full_prompt = visual_prompt
                
                logger.debug("Submitting Veo3 job %s/%s", idx + 1, len(videos))

                # Build metadata including cache info
                metadata = {
                    "runId": self.run_id,
                    "videoIndex": idx,
                    "hasVoiceOver": bool(voice_over),
                }
                
                # Add cache metadata if provided
                if video.get("topic"):
                    metadata["topic"] = video["topic"]
                if video.get("sign"):
                    metadata["sign"] = video["sign"]
                if video.get("object_name"):
                    metadata["object_name"] = video["object_name"]
                
                payload = {
                    "prompt": full_prompt,
                    "model": self.model,
                    "aspectRatio": aspect_ratio,
                    # Callback URL with run_id for correlation
                    "callBackUrl": self.callback_url,
                    "metadata": metadata,
                }

                logger.info("KIE.ai callback URL: %s", self.callback_url)

                try:
                    response = client.post(
                        VEO3_GENERATE_URL,
                        headers=headers,
                        json=payload,
                    )
                    response.raise_for_status()

                    data = response.json()
                    
                    if data.get("code") == 200:
                        task_id = data.get("data", {}).get("taskId")
                        if task_id:
                            task_ids.append(task_id)
                            # Store metadata mapping for webhook lookup
                            # (KIE.ai doesn't return our metadata in callback)
                            task_metadata[task_id] = {
                                "topic": video.get("topic"),
                                "sign": video.get("sign"),
                                "object_name": video.get("object_name"),
                                "video_index": idx,
                            }
                            logger.info("Veo3 task submitted: %s", task_id)
                        else:
                            error_msg = f"Video {idx}: Response missing taskId"
                            errors.append(error_msg)
                            logger.warning(error_msg)
                    else:
                        error_msg = f"Video {idx}: API error - {data.get('msg', 'Unknown error')}"
                        errors.append(error_msg)
                        logger.warning(error_msg)
                        
                except httpx.HTTPStatusError as e:
                    error_msg = f"Video {idx}: HTTP {e.response.status_code}"
                    errors.append(error_msg)
                    logger.warning(error_msg)
                except Exception as e:
                    error_msg = f"Video {idx}: {type(e).__name__} - {str(e)}"
                    errors.append(error_msg)
                    logger.warning(error_msg)

        # Fail only if no tasks were submitted at all
        if not task_ids:
            raise ValueError(f"Failed to submit any tasks: {errors}")

        logger.info(
            "Submitted %s/%s Veo3 tasks with callback URL: %s",
            len(task_ids),
            len(videos),
            self.callback_url,
        )

        # Store task_metadata mapping in the database for webhook lookup
        # (KIE.ai doesn't return our custom metadata in callbacks)
        if self.run_id and task_metadata:
            self._store_task_metadata(task_metadata)

        result = {
            "task_ids": task_ids,
            "task_metadata": task_metadata,  # For webhook lookup of cache metadata
            "status": "submitted",
            "model": self.model,
            "task_count": len(task_ids),
            "run_id": self.run_id,
            "message": "Videos with voice over will be delivered via webhook when ready",
        }
        
        if errors:
            result["errors"] = errors
            result["partial_success"] = True
            
        return format_tool_success(
            result,
            message=f"Submitted {len(task_ids)} Veo3 video tasks (voice over enabled)",
        )
