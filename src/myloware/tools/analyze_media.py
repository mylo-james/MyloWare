"""Media analysis tool for vision-based editing decisions.

Uses OpenAI Vision API to analyze images/video frames and provide
editing recommendations (colors, composition, transitions, pacing).

Implements caching: identical requests (media_url + analysis_type) within a run
are cached to reduce API costs.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict
from uuid import UUID

from openai import AsyncOpenAI

from myloware.config import settings
from myloware.observability.logging import get_logger
from myloware.storage.database import get_async_session_factory
from myloware.storage.models import ArtifactType
from myloware.storage.repositories import ArtifactRepository
from myloware.tools.base import JSONSchema, MylowareBaseTool, format_tool_error, format_tool_success

logger = get_logger(__name__)

__all__ = ["AnalyzeMediaTool"]


class AnalyzeMediaTool(MylowareBaseTool):
    """Analyze images or video frames to inform editing decisions.

    Uses OpenAI Vision API (gpt-4o) to extract:
    - Content description
    - Dominant colors and color palette
    - Composition analysis (rule of thirds, focal points, safe zones)
    - Editing recommendations (transitions, pacing, styling)

    Implements caching: identical requests (media_url + analysis_type) within a run
    are cached to reduce API costs (~$0.01-0.03 per image).
    """

    def __init__(
        self,
        run_id: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ):
        """Initialize the vision analysis tool.

        Args:
            run_id: Optional run ID for caching within a run
            api_key: Optional OpenAI API key (defaults to settings.openai_api_key)
            model: Optional model name (defaults to "gpt-4o")
        """
        super().__init__()
        self.run_id = run_id
        self.api_key = api_key or getattr(settings, "openai_api_key", None)
        self.model = model or "gpt-4o-2024-08-06"  # Use specific vision-capable model

        if not self.api_key:
            raise ValueError("OpenAI API key required for vision analysis")

        self.openai_client = AsyncOpenAI(api_key=self.api_key)

        logger.info(
            "AnalyzeMediaTool initialized (run_id=%s, model=%s, api_key_present=%s)",
            self.run_id,
            self.model,
            bool(self.api_key),
        )

    def get_name(self) -> str:
        """Return tool name."""
        return "analyze_media"

    def get_description(self) -> str:
        """Return tool description for agent."""
        return (
            "Analyze images or video frames to inform editing decisions. "
            "Returns: content description, dominant colors, composition analysis, "
            "suggested transitions, and pacing recommendations. "
            "Use this before composing videos to make informed creative decisions. "
            "Cost: ~$0.01-0.03 per image (use 'low' detail for simple checks, analyze key frames only)."
        )

    def get_input_schema(self) -> JSONSchema:
        """Return JSON Schema for tool input."""
        return {
            "type": "object",
            "properties": {
                "media_url": {
                    "type": "string",
                    "description": "URL to image or video frame to analyze (supports HTTP/HTTPS URLs and base64 data URIs)",
                },
                "analysis_type": {
                    "type": "string",
                    "enum": ["content", "colors", "composition", "full"],
                    "default": "full",
                    "description": (
                        "Type of analysis: 'content' (brief description), "
                        "'colors' (color palette only), 'composition' (layout/focal points), "
                        "'full' (comprehensive analysis for editing)"
                    ),
                },
                "editing_context": {
                    "type": "string",
                    "description": "Optional context about what editing decision this analysis informs (e.g., 'Choose transition style', 'Extract colors for text overlays')",
                },
            },
            "required": ["media_url"],
        }

    def _compute_cache_key(self, media_url: str, analysis_type: str) -> str:
        """Compute cache key from media_url + analysis_type.

        Args:
            media_url: URL to image or video frame
            analysis_type: Type of analysis to perform

        Returns:
            Hex digest of the cache key
        """
        key_data = {
            "media_url": media_url,
            "analysis_type": analysis_type,
        }
        key_str = json.dumps(key_data, sort_keys=True)
        return hashlib.sha256(key_str.encode()).hexdigest()

    async def _check_cache(self, cache_key: str) -> Dict[str, Any] | None:
        """Check if this request is cached for this run.

        Args:
            cache_key: The computed cache key

        Returns:
            Cached analysis result if found, None otherwise
        """
        if not self.run_id:
            return None

        SessionLocal = get_async_session_factory()
        async with SessionLocal() as session:
            repo = ArtifactRepository(session)
            artifacts = await repo.get_by_run_async(UUID(self.run_id))

            # Look for VISION_ANALYSIS artifacts with matching cache_key
            for artifact in artifacts:
                if artifact.artifact_type == ArtifactType.VISION_ANALYSIS.value:
                    metadata = artifact.artifact_metadata or {}
                    if metadata.get("cache_key") == cache_key and artifact.content:
                        try:
                            cached_result = json.loads(artifact.content)
                            logger.info(
                                "Found cached vision analysis (cache_key=%s, media_url=%s)",
                                cache_key[:16],
                                metadata.get("media_url", "unknown")[:50],
                            )
                            return cached_result
                        except Exception as e:
                            logger.warning("Failed to parse cached analysis: %s", e)
                            return None

        return None

    async def _store_cache(
        self, cache_key: str, media_url: str, analysis_type: str, result: Dict[str, Any]
    ) -> None:
        """Store analysis result in cache for this run.

        Args:
            cache_key: The computed cache key
            media_url: URL to image or video frame
            analysis_type: Type of analysis performed
            result: The analysis result to cache
        """
        if not self.run_id:
            return

        SessionLocal = get_async_session_factory()
        async with SessionLocal() as session:
            repo = ArtifactRepository(session)
            await repo.create_async(
                run_id=UUID(self.run_id),
                persona="editor",
                artifact_type=ArtifactType.VISION_ANALYSIS,
                content=json.dumps(result),
                metadata={
                    "cache_key": cache_key,
                    "media_url": media_url,
                    "analysis_type": analysis_type,
                    "model": self.model,
                },
            )
            await session.commit()
        logger.debug("Stored vision analysis in cache (cache_key=%s)", cache_key[:16])

    async def async_run_impl(
        self,
        media_url: str,
        analysis_type: str = "full",
        editing_context: str = "",
    ) -> Dict[str, Any]:
        """Execute vision analysis using OpenAI Vision API.

        Args:
            media_url: URL to image or video frame
            analysis_type: Type of analysis to perform
            editing_context: Context for the editing decision

        Returns:
            Analysis result with content, colors, composition, recommendations

        Note:
            Identical requests (media_url + analysis_type) within a run are cached
            to reduce API costs. Cache behavior: hash(media_url + analysis_type).
        """
        # Check cache first
        cache_key = self._compute_cache_key(media_url, analysis_type)
        cached = await self._check_cache(cache_key)
        if cached:
            return format_tool_success(
                {
                    **cached,
                    "cached": True,
                    "analysis_type": analysis_type,
                    "model": self.model,
                    "media_url": media_url,
                },
                message=f"Analysis complete (cached) for {analysis_type}",
            )

        try:
            prompt = self._build_prompt(analysis_type, editing_context)

            logger.info(
                "Analyzing media (url=%s, type=%s, context=%s)",
                media_url[:100] if len(media_url) > 100 else media_url,
                analysis_type,
                editing_context[:50] if editing_context else "none",
            )

            # Use OpenAI Vision API
            response = await self.openai_client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": media_url,
                                    "detail": "high" if analysis_type == "full" else "low",
                                },
                            },
                        ],
                    }
                ],
                max_tokens=500,
            )

            analysis_text = response.choices[0].message.content or ""

            logger.info(
                "Analysis complete (type=%s, tokens=%s)",
                analysis_type,
                response.usage.total_tokens if hasattr(response, "usage") else "unknown",
            )

            result_data = {
                "analysis": analysis_text,
                "analysis_type": analysis_type,
                "model": self.model,
                "media_url": media_url,
            }

            # Store in cache for future requests
            await self._store_cache(cache_key, media_url, analysis_type, result_data)

            return format_tool_success(
                result_data,
                message=f"Analysis complete for {analysis_type}",
            )

        except Exception as exc:
            logger.exception("Failed to analyze media: %s", exc)
            err = format_tool_error(
                "analysis_failed",
                f"Vision analysis failed: {str(exc)}",
                {"media_url": media_url, "analysis_type": analysis_type},
            )
            # Preserve legacy error flag but provide structured error info for callers/tests
            err["error_detail"] = err["error"]
            err["error"] = {
                "code": "analysis_failed",
                "message": err.get("message"),
                "type": err.get("error_type"),
            }
            err["success"] = False
            return err

    def _build_prompt(self, analysis_type: str, editing_context: str) -> str:
        """Build analysis prompt based on type and context.

        Args:
            analysis_type: Type of analysis (content, colors, composition, full)
            editing_context: Context about editing decision

        Returns:
            Prompt string for vision model
        """
        prompts = {
            "content": (
                "Briefly describe what's in this image or video frame. "
                "Focus on: subject matter, mood, setting, key visual elements."
            ),
            "colors": (
                "Extract the dominant colors and color palette from this image. "
                "Provide: 1) Primary colors (hex codes), 2) Secondary colors, "
                "3) Overall color temperature (warm/cool), 4) Suggested complementary colors for text overlays."
            ),
            "composition": (
                "Analyze the composition of this image/video frame. "
                "Provide: 1) Rule of thirds placement, 2) Focal points, "
                "3) Safe zones for text overlays (top/bottom 20%), 4) Visual balance."
            ),
            "full": (
                f"For video editing: {editing_context or 'Analyze this frame for editing decisions'}. "
                "Provide a comprehensive analysis:\n"
                "1) Content description (subject, mood, setting)\n"
                "2) Dominant colors and color palette (hex codes)\n"
                "3) Composition analysis (rule of thirds, focal points, safe zones)\n"
                "4) Suggested transition type (e.g., soft dissolve, cut, fade, wipe)\n"
                "5) Pacing recommendations (fast/slow, energetic/calm)"
            ),
        }

        return prompts.get(analysis_type, prompts["full"])
