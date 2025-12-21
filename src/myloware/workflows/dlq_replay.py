"""Dead letter replay logic shared by API and CLI.

This module keeps replay decisions out of FastAPI route modules so operators
can reuse the same logic via CLI without importing route internals.
"""

from __future__ import annotations

import json
from typing import Any

from myloware.observability.logging import get_logger
from myloware.workflows.langgraph import resume as resume_ops

logger = get_logger(__name__)


def _extract_sora_video_urls(payload: dict[str, Any]) -> list[str]:
    video_urls = payload.get("video_urls") or payload.get("video_clips") or []
    if video_urls:
        return list(video_urls)

    data_block = payload.get("data") or {}
    result_json = data_block.get("resultJson")
    if isinstance(result_json, str):
        try:
            parsed = json.loads(result_json)
            urls = parsed.get("resultUrls") or []
            if urls:
                return list(urls)
        except json.JSONDecodeError:
            logger.debug("Failed to parse sora resultJson payload; skipping resultUrls extraction")

    info = data_block.get("info") or {}
    if isinstance(info, dict):
        urls = info.get("resultUrls") or []
        if urls:
            return list(urls)

    return []


def _extract_remotion_video_url(payload: dict[str, Any]) -> str | None:
    return payload.get("video_url") or payload.get("final_video_url")


async def replay_dead_letter(dead_letter: Any) -> dict[str, Any]:
    """Replay a dead-lettered webhook payload.

    Args:
        dead_letter: storage.models.DeadLetter-like object

    Returns:
        Dict payload describing replay outcome.

    Raises:
        ValueError for unknown sources or missing required payload fields.
    """
    source = getattr(dead_letter, "source", None)
    payload = getattr(dead_letter, "payload", None) or {}

    if not isinstance(payload, dict):
        raise ValueError("Dead letter payload must be a JSON object")

    if source == "sora":
        video_urls = _extract_sora_video_urls(payload)
        if not video_urls:
            raise ValueError(f"Dead letter {dead_letter.id} missing video_urls for replay")
        await resume_ops.resume_after_videos(dead_letter.run_id, raise_on_error=True)
        return {
            "status": "replayed",
            "dead_letter_id": str(dead_letter.id),
            "source": source,
            "video_urls": video_urls,
        }

    if source == "remotion":
        video_url = _extract_remotion_video_url(payload)
        if not video_url:
            raise ValueError(f"Dead letter {dead_letter.id} missing video_url for replay")
        await resume_ops.resume_after_render(dead_letter.run_id, video_url, raise_on_error=True)
        return {
            "status": "replayed",
            "dead_letter_id": str(dead_letter.id),
            "source": source,
            "video_url": video_url,
        }

    raise ValueError(f"Unknown source: {source}")
