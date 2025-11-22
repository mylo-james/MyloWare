from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast
import json

from .validator import _extract_project_spec_from_payload


def _coerce_result_dict(value: Any) -> dict[str, Any]:
    """Normalize stored payload/result blobs into a dict."""
    if value is None:
        return {}
    if isinstance(value, dict):
        # Assume JSON-like mapping with string keys.
        return dict(cast(Mapping[str, Any], value))
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, Mapping):
                return dict(cast(Mapping[str, Any], parsed))
            return {}
        except json.JSONDecodeError:
            return {}
    return dict(value)


def mark_video_generated_impl(
    service: Any,
    *,
    run_id: str,
    video: Mapping[str, Any],
    asset_url: str | None,
    prompt: str,
) -> None:
    if not asset_url:
        raise ValueError("kie.ai event missing assetUrl")

    record = service._db.get_run(run_id)
    payload = _coerce_result_dict(record.get("payload") if record else None)
    project_spec = _extract_project_spec_from_payload(payload)
    specs = (project_spec.get("specs") or {}) if isinstance(project_spec, Mapping) else {}
    expected_total = specs.get("videoCount")
    default_duration = float(specs.get("videoDuration") or 8.0)
    result = _coerce_result_dict(record.get("result") if record else None)
    videos = result.setdefault("videos", [])
    entry = None
    for item in videos:
        if item.get("index") == video.get("index"):
            entry = item
            break
    if entry is None:
        entry = {"index": video.get("index")}
        videos.append(entry)

    entry.update(
        {
            "subject": video.get("subject"),
            "header": video.get("header"),
            "status": "generated",
            "assetUrl": asset_url,
            "prompt": prompt,
            "duration": float(entry.get("duration") or default_duration),
        }
    )

    result["videos"] = videos
    if expected_total:
        result["totalVideos"] = int(expected_total)
    else:
        result.setdefault("totalVideos", len(videos))
    service._db.update_run(run_id=run_id, status="generating", result=result)


def hydrate_video_spec_impl(
    service: Any,
    *,
    run_id: str,
    video: Mapping[str, Any],
) -> dict[str, Any]:
    """Ensure subject/header are populated for downstream tooling."""
    enriched: dict[str, Any] = dict(video)
    if enriched.get("subject") and enriched.get("header"):
        return enriched

    record = service._db.get_run(run_id)
    if record:
        result = _coerce_result_dict(record.get("result"))
        for item in result.get("videos", []):
            if item.get("index") == enriched.get("index"):
                enriched.setdefault("subject", item.get("subject"))
                enriched.setdefault("header", item.get("header"))
                break
        if not (enriched.get("subject") and enriched.get("header")):
            payload = _coerce_result_dict(record.get("payload"))
            project_spec = _extract_project_spec_from_payload(payload)
            specs = (project_spec.get("specs") or {}) if isinstance(project_spec, Mapping) else {}
            videos = specs.get("videos") or []
            try:
                idx = int(enriched.get("index", 0))
            except (TypeError, ValueError):
                idx = None
            if isinstance(idx, int) and 0 <= idx < len(videos):
                template = videos[idx] or {}
                if not enriched.get("subject"):
                    enriched["subject"] = template.get("subject")
                if not enriched.get("header"):
                    enriched["header"] = template.get("header")
    return enriched
