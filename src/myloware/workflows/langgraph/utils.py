"""Shared LangGraph workflow utilities.

Currently includes helpers for deterministic ordering of video clip artifacts.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, List, Sequence, Tuple
from urllib.parse import urlparse

from myloware.config import settings
from myloware.storage.models import ArtifactType
from myloware.observability.logging import get_logger

logger = get_logger(__name__)


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


def normalize_transcoded_url(url: str | None) -> str | None:
    """Rebase transcoded media URLs to the current webhook base URL."""
    if not url:
        return url

    base = str(getattr(settings, "webhook_base_url", "") or "").rstrip("/")
    if not base:
        return url

    # In production we store transcoded clips as durable s3:// URIs. For tool prompts
    # and render services, prefer a short stable media proxy URL rather than huge
    # presigned URLs (LLMs may truncate/alter them).
    if url.startswith("s3://"):
        try:
            from myloware.storage.object_store import parse_s3_uri

            ref = parse_s3_uri(url)
        except Exception:
            return url

        bucket = str(getattr(settings, "transcode_s3_bucket", "") or "").strip()
        prefix = str(getattr(settings, "transcode_s3_prefix", "") or "").strip().strip("/")
        if bucket and ref.bucket == bucket:
            key_norm = ref.key.lstrip("/")
            prefix_norm = prefix.lstrip("/")
            if not prefix_norm or key_norm == prefix_norm or key_norm.startswith(f"{prefix_norm}/"):
                filename = key_norm.split("/")[-1]
                if filename:
                    return f"{base}/v1/media/transcoded/{filename}"

    path: str | None = None
    if url.startswith("/v1/media/transcoded/"):
        path = url
    else:
        try:
            parsed = urlparse(url)
        except Exception:
            return url
        if parsed.path and parsed.path.startswith("/v1/media/transcoded/"):
            path = parsed.path

    if not path:
        return url

    return f"{base}{path}"


def select_latest_video_clip_urls(artifacts: Sequence[Any]) -> List[str]:
    """Return clip URIs for the latest clip_manifest, falling back to all clips.

    This avoids replaying runs with stale clips from earlier generations.
    """

    manifests = [
        a
        for a in artifacts
        if getattr(a, "artifact_type", None) == ArtifactType.CLIP_MANIFEST.value
    ]
    if not manifests:
        return [normalize_transcoded_url(u) or u for u in sorted_video_clip_urls(artifacts)]

    def manifest_key(a: Any) -> datetime:
        created = getattr(a, "created_at", None)
        return created if isinstance(created, datetime) else datetime.min

    latest_manifest = max(manifests, key=manifest_key)
    try:
        manifest_data = json.loads(getattr(latest_manifest, "content", "") or "{}")
        task_ids = list(manifest_data.keys()) if isinstance(manifest_data, dict) else []
    except Exception as exc:
        logger.warning("clip_manifest_parse_failed", exc=str(exc))
        return [normalize_transcoded_url(u) or u for u in sorted_video_clip_urls(artifacts)]

    if not task_ids:
        logger.warning("clip_manifest_empty_task_ids")
        return [normalize_transcoded_url(u) or u for u in sorted_video_clip_urls(artifacts)]

    clips = [
        a
        for a in artifacts
        if getattr(a, "artifact_type", None) == ArtifactType.VIDEO_CLIP.value
        and getattr(a, "uri", None)
        and isinstance(getattr(a, "artifact_metadata", None) or {}, dict)
        and (getattr(a, "artifact_metadata", None) or {}).get("task_id") in task_ids
    ]
    expected_count = None
    manifest_meta = getattr(latest_manifest, "artifact_metadata", None)
    if isinstance(manifest_meta, dict):
        expected_count = manifest_meta.get("task_count")
    if expected_count and isinstance(expected_count, int) and len(clips) < expected_count:
        logger.warning(
            "clip_manifest_incomplete",
            expected=int(expected_count),
            received=len(clips),
        )
        return []
    if not clips:
        logger.warning("clip_manifest_no_matching_clips", task_count=len(task_ids))
        return []

    return [
        normalize_transcoded_url(a.uri) or a.uri
        for a in sorted_video_clip_artifacts(clips)
        if getattr(a, "uri", None)
    ]


__all__ = [
    "sorted_video_clip_artifacts",
    "sorted_video_clip_urls",
    "normalize_transcoded_url",
    "select_latest_video_clip_urls",
]
