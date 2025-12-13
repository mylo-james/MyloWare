"""Shared LangGraph workflow utilities.

Currently includes helpers for deterministic ordering of video clip artifacts.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Sequence, Tuple

from storage.models import ArtifactType


def _video_index_from_metadata(meta: dict[str, Any] | None, fallback: int) -> int:
    if not meta:
        return fallback
    raw = None
    for key in ("video_index", "videoIndex", "idx", "index"):
        if key in meta:
            raw = meta.get(key)
            break
    try:
        return int(raw)
    except Exception:
        return fallback


def sorted_video_clip_artifacts(artifacts: Sequence[Any]) -> List[Any]:
    """Return VIDEO_CLIP artifacts sorted by video_index then created_at.

    Artifacts may be ORM objects or simple mocks with the same attributes.
    """

    clips: List[Any] = [
        a
        for a in artifacts
        if getattr(a, "artifact_type", None) == ArtifactType.VIDEO_CLIP.value
        and getattr(a, "uri", None)
    ]

    def sort_key(a: Any) -> Tuple[int, datetime]:
        meta = getattr(a, "artifact_metadata", None) or {}
        idx = _video_index_from_metadata(meta, fallback=10**9)
        created = getattr(a, "created_at", None) or datetime.min
        return idx, created

    return sorted(clips, key=sort_key)


def sorted_video_clip_urls(artifacts: Sequence[Any]) -> List[str]:
    """Return sorted clip URIs for the given artifacts."""

    return [a.uri for a in sorted_video_clip_artifacts(artifacts) if getattr(a, "uri", None)]


__all__ = [
    "sorted_video_clip_artifacts",
    "sorted_video_clip_urls",
]
