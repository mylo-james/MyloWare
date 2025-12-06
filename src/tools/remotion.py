"""Remotion video rendering tool for Llama Stack agents.

Submits compositions to the self-hosted Remotion render service.
Supports both custom TSX code and pre-built templates.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from config import settings
from tools.base import (
    MylowareBaseTool,
    ToolParamDefinition,
    format_tool_success,
)

logger = logging.getLogger(__name__)

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
    ) -> None:
        self.run_id = run_id
        self.timeout = timeout
        self.base_url = getattr(settings, "remotion_service_url", "http://localhost:3001")
        webhook_base = getattr(settings, "webhook_base_url", "")
        self.callback_url = (
            f"{webhook_base}/v1/webhooks/remotion?run_id={run_id}" if webhook_base and run_id else None
        )
        self.use_fake = getattr(settings, "use_fake_providers", False)

        if not self.use_fake and not self.base_url:
            raise ValueError("REMOTION_SERVICE_URL must be configured")

    def get_name(self) -> str:
        return "remotion_render"

    def get_description(self) -> str:
        return (
            "Render a video using Remotion. Use 'template' for pre-built compositions "
            "(e.g., 'aismr' for zodiac videos) or provide custom 'composition_code'. "
            "For AISMR template: provide clips (12 video URLs) and objects (12 object names)."
        )

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "clips": ToolParamDefinition(
                param_type="list",
                description="Array of video clip URLs in order",
                required=True,
            ),
            "template": ToolParamDefinition(
                param_type="str",
                description="Template name (e.g., 'aismr'). Use instead of composition_code.",
                required=False,
            ),
            "composition_code": ToolParamDefinition(
                param_type="str",
                description="Custom React/TSX code (used if no template specified)",
                required=False,
            ),
            "objects": ToolParamDefinition(
                param_type="list",
                description=(
                    "REQUIRED for AISMR template. Array of 12 CREATIVE OBJECT NAMES "
                    "(e.g., 'Flame Spirit', 'Earth Golem', 'Shadow Serpent') - "
                    "NOT zodiac signs! These are displayed as text overlays in the video."
                ),
                required=False,
            ),
            "duration_seconds": ToolParamDefinition(
                param_type="float",
                description="Total video duration in seconds. AISMR template: 74s",
                required=False,
                default=10,
            ),
            "fps": ToolParamDefinition(
                param_type="int",
                description="Frames per second (24, 30, or 60)",
                required=False,
                default=30,
            ),
            "aspect_ratio": ToolParamDefinition(
                param_type="str",
                description="Video aspect ratio: '9:16', '16:9', or '1:1'",
                required=False,
                default="9:16",
            ),
        }

    def run_impl(
        self,
        clips: List[str],
        template: Optional[str] = None,
        composition_code: Optional[str] = None,
        objects: Optional[List[str]] = None,
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
        
        # Validate objects for AISMR template - reject if they look like zodiac signs
        if template == "aismr" and objects:
            zodiac_signs = {
                "aries", "taurus", "gemini", "cancer", "leo", "virgo",
                "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"
            }
            invalid_objects = [o for o in objects if o.lower() in zodiac_signs]
            if invalid_objects:
                raise ValueError(
                    f"INVALID OBJECTS: {invalid_objects} are zodiac SIGNS, not creative object names! "
                    f"Objects should be creative names like 'Flame Spirit', 'Earth Golem', etc. "
                    f"Check the 'Objects (in order)' section of your input and use those exact values."
                )

        dimensions = {
            "9:16": (1080, 1920),
            "16:9": (1920, 1080),
            "1:1": (1080, 1080),
        }
        width, height = dimensions.get(aspect_ratio, (1080, 1920))
        duration_frames = int(duration_seconds * fps)

        if self.use_fake:
            logger.info("Fake Remotion render submission (run_id=%s, template=%s)", self.run_id, template)
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
        else:
            payload["composition_code"] = composition_code

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(f"{self.base_url}/api/render", json=payload)
            response.raise_for_status()
            result = response.json()

        logger.info("Remotion render job submitted: %s (template=%s)", result.get("job_id"), template)

        return format_tool_success(
            data={
                "job_id": result.get("job_id"),
                "status": result.get("status"),
                "template": template,
                "service": "remotion",
            },
            message="Render job submitted to Remotion service" + (f" using {template} template" if template else ""),
        )
