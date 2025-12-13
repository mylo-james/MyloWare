"""Remotion video rendering tool for Llama Stack agents.

Submits compositions to the self-hosted Remotion render service.
Supports both custom TSX code and pre-built templates.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx
from opentelemetry import trace

from config import settings
from observability.logging import get_logger
from tools.base import (
    MylowareBaseTool,
    JSONSchema,
    format_tool_success,
)

logger = get_logger(__name__)
tracer = trace.get_tracer("myloware.tools.remotion")

__all__ = ["RemotionRenderTool"]


class RemotionRenderTool(MylowareBaseTool):
    """Render video compositions using self-hosted Remotion service.

    Supports two modes:
    1. Template mode: Use a pre-built template (e.g., "aismr") with data
    2. Custom mode: Provide React/TSX composition code directly
    """

    def __init__(
        self,
        run_id: str | None = None,
        timeout: float = 30.0,
        project: str | None = None,
    ) -> None:
        self.run_id = run_id
        self.timeout = timeout
        self.project = project
        self.base_url = getattr(settings, "remotion_service_url", "http://localhost:3001")
        webhook_base = getattr(settings, "webhook_base_url", "")
        self.callback_url = (
            f"{webhook_base}/v1/webhooks/remotion?run_id={run_id}"
            if webhook_base and run_id
            else None
        )
        self.provider_mode = getattr(settings, "remotion_provider", "real")
        if self.provider_mode == "off":
            raise ValueError("Remotion provider is disabled (REMOTION_PROVIDER=off)")
        self.use_fake = self.provider_mode == "fake"
        self.api_secret = getattr(settings, "remotion_api_secret", "")
        self.allow_composition_code = getattr(settings, "remotion_allow_composition_code", False)
        self.sandbox_enabled = getattr(settings, "remotion_sandbox_enabled", False)

        # Load project-specific validator if project is specified
        self._object_validator_name: str | None = None
        if project:
            try:
                from config.projects import load_project

                project_config = load_project(project)
                self._object_validator_name = project_config.object_validator
            except Exception as e:
                logger.debug("Could not load project config for validation: %s", e)

        if self.provider_mode == "real" and not self.base_url:
            raise ValueError("REMOTION_SERVICE_URL must be configured")

    def get_name(self) -> str:
        return "remotion_render"

    def get_description(self) -> str:
        desc = (
            "Render a video using Remotion. "
            "Templates: 'aismr' (12 zodiac clips + objects), 'motivational' (2 clips + 4 text overlays). "
        )
        if self.allow_composition_code:
            desc += (
                "OR write custom React/TSX composition_code for full creative control. "
                "Query knowledge base for Remotion API, components, animations. "
            )
        else:
            desc += "For custom compositions, enable REMOTION_ALLOW_COMPOSITION_CODE=true."
        return desc

    def get_input_schema(self) -> JSONSchema:
        return {
            "type": "object",
            "properties": {
                "clips": {
                    "type": "array",
                    "description": "Array of video clip URLs in order",
                    "items": {"type": "string"},
                },
                "template": {
                    "type": "string",
                    "description": "Template name (e.g., 'aismr'). Use instead of composition_code.",
                },
                "composition_code": {
                    "type": "string",
                    "description": "Custom React/TSX code (used if no template specified)",
                },
                "objects": {
                    "type": "array",
                    "description": (
                        "REQUIRED for AISMR template. Array of 12 CREATIVE OBJECT NAMES "
                        "(e.g., 'Flame Spirit', 'Earth Golem', 'Shadow Serpent') - "
                        "NOT zodiac signs! These are displayed as text overlays in the video."
                    ),
                    "items": {"type": "string"},
                },
                "texts": {
                    "type": "array",
                    "description": (
                        "REQUIRED for MOTIVATIONAL template. Array of 4 text overlays "
                        "displayed sequentially (4 seconds each). Extract from ideation."
                    ),
                    "items": {"type": "string"},
                },
                "duration_seconds": {
                    "type": "number",
                    "description": "Total video duration in seconds. AISMR template: 74s",
                    "default": 10,
                },
                "fps": {
                    "type": "integer",
                    "description": "Frames per second (24, 30, or 60)",
                    "default": 30,
                },
                "aspect_ratio": {
                    "type": "string",
                    "description": "Video aspect ratio: '9:16', '16:9', or '1:1'",
                    "default": "9:16",
                },
            },
            "required": ["clips"],
        }

    def _validate_result(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Validate render submission response."""
        if not result.get("job_id"):
            raise ValueError("job_id is required in Remotion result")
        return result

    # run_impl is handled by MylowareBaseTool which wraps async_run_impl

    async def async_run_impl(
        self,
        clips: List[str],
        template: Optional[str] = None,
        composition_code: Optional[str] = None,
        objects: Optional[List[str]] = None,
        texts: Optional[List[str]] = None,
        duration_seconds: float = 10,
        fps: int = 30,
        aspect_ratio: str = "9:16",
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Submit composition to Remotion render service."""
        if not clips:
            raise ValueError("At least one clip URL is required")

        if not template and not composition_code:
            raise ValueError("Either 'template' or 'composition_code' must be provided")

        if (
            composition_code
            and not self.use_fake
            and not (self.allow_composition_code and self.sandbox_enabled)
        ):
            raise ValueError(
                "composition_code is disabled. Enable sandbox + allowlist to use dynamic code or use a template."
            )

        # Validate objects using project-specific validator (if configured)
        if objects and self._object_validator_name:
            from workflows.validators import validate_objects

            is_valid, error_msg = validate_objects(self._object_validator_name, objects)
            if not is_valid:
                raise ValueError(error_msg)

        dimensions = {
            "9:16": (1080, 1920),
            "16:9": (1920, 1080),
            "1:1": (1080, 1080),
        }
        width, height = dimensions.get(aspect_ratio, (1080, 1920))
        duration_frames = int(duration_seconds * fps)

        if self.use_fake:
            logger.info(
                "Fake Remotion render submission (run_id=%s, template=%s)", self.run_id, template
            )
            return format_tool_success(
                data={
                    "job_id": f"fake-remotion-{self.run_id or '0000'}",
                    "status": "queued",
                    "template": template,
                    "estimated_duration_seconds": duration_seconds,
                },
                message="Render job queued (fake mode)",
            )

        payload = {
            "run_id": self.run_id,
            "clips": clips,
            "duration_frames": duration_frames,
            "fps": fps,
            "width": width,
            "height": height,
            "callback_url": self.callback_url,
        }

        # Add template or composition_code
        if template:
            payload["template"] = template
            if objects:
                payload["objects"] = objects
            if texts:
                payload["texts"] = texts
        else:
            payload["composition_code"] = composition_code

        headers = {}
        if self.api_secret:
            headers["Authorization"] = f"Bearer {self.api_secret}"
            headers["x-api-key"] = self.api_secret

        with tracer.start_as_current_span(
            "remotion_render",
            attributes={
                "service.url": self.base_url,
                "has_template": bool(template),
                "has_composition_code": bool(composition_code),
                "run_id": self.run_id or "",
            },
        ):
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/render", json=payload, headers=headers
                )
                response.raise_for_status()
                result = response.json()

        logger.info(
            "Remotion render job submitted: %s (template=%s)", result.get("job_id"), template
        )

        return format_tool_success(
            data={
                "job_id": result.get("job_id"),
                "status": result.get("status"),
                "template": template,
                "service": "remotion",
            },
            message="Render job submitted to Remotion service"
            + (f" using {template} template" if template else ""),
        )
