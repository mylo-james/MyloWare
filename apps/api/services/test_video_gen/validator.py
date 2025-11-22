from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _first_non_empty(run_input: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = run_input.get(key)
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                return trimmed
    return None


def _extract_generation_config(
    run_input: Mapping[str, Any],
    *,
    default_duration: int,
    default_quality: str,
    default_aspect_ratio: str,
    model: str,
) -> dict[str, Any]:
    """Derive generation settings (prompt/model/duration/quality/aspect)."""
    prompt = _first_non_empty(run_input, "prompt", "title", "topic", "object", "subject")
    if not prompt:
        prompt = "MyloWare production run"
    duration = int(run_input.get("duration") or default_duration)
    quality = str(run_input.get("quality") or default_quality)
    aspect_ratio = str(
        run_input.get("aspectRatio") or run_input.get("aspect_ratio") or default_aspect_ratio,
    )
    target_model = str(run_input.get("model") or model)
    return {
        "prompt": prompt,
        "duration": duration,
        "quality": quality,
        "aspect_ratio": aspect_ratio,
        "model": target_model,
    }


def _derive_pipeline(*, project: str, project_spec: Mapping[str, Any]) -> list[str]:
    """Return the persona pipeline for a project."""
    if project == "test_video_gen":
        return ["iggy", "riley", "alex", "quinn"]
    workflow = project_spec.get("workflow") or []
    filtered = [persona for persona in workflow if persona not in {"brendan", "supervisor"}]
    return filtered or ["iggy", "riley", "alex", "quinn"]


def _derive_hitl_points(project_spec: Mapping[str, Any]) -> list[str]:
    """Resolve HITL gate points for a project."""
    if project_spec.get("hitlPoints"):
        return list(project_spec["hitlPoints"])
    settings = project_spec.get("settings") or {}
    return list(settings.get("hitlPoints") or [])


def _extract_project_spec_from_payload(payload: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """Pull the project_spec blob from a run payload or metadata."""
    if not payload:
        return {}
    direct = payload.get("project_spec")
    if isinstance(direct, Mapping):
        return direct
    metadata = payload.get("metadata")
    if isinstance(metadata, Mapping):
        nested = metadata.get("project_spec")
        if isinstance(nested, Mapping):
            return nested
    return {}


def _extract_videos_spec(
    project: str,
    project_spec: Mapping[str, Any],
    run_input: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Build the per-video spec list for the given project."""
    specs = project_spec.get("specs") or {}
    if project == "aismr":
        # AISMR requires 12 clips with surreal modifiers. Use provided modifiers when available.
        count = int(specs.get("videoCount") or 12)
        base_subject = str(
            run_input.get("object")
            or run_input.get("subject")
            or project_spec.get("title")
            or "Surreal Object"
        )
        modifiers = run_input.get("modifiers")
        normalized_clips: list[dict[str, Any]] = []
        for index in range(count):
            if isinstance(modifiers, list) and index < len(modifiers):
                header = str(modifiers[index])
            else:
                header = f"{base_subject.title()} #{index + 1}"
            normalized_clips.append({"subject": base_subject, "header": header})
        return normalized_clips

    videos = specs.get("videos") or []
    normalized_videos: list[dict[str, Any]] = []
    for index, video in enumerate(videos):
        subject = str(video.get("subject") or f"Video {index + 1}")
        header = str(video.get("header") or subject.title())
        normalized_videos.append({"subject": subject, "header": header})
    if not normalized_videos:
        title = str(project_spec.get("title") or "Test Video")
        normalized_videos = [{"subject": title, "header": title}]
    return normalized_videos


def _hydrate_video_spec_from_context(
    *,
    run_record: Mapping[str, Any] | None,
    video: Mapping[str, Any],
) -> dict[str, Any]:
    """Helper used when enriching video specs from run context."""
    enriched: dict[str, Any] = dict(video)
    if enriched.get("subject") and enriched.get("header"):
        return enriched

    if not run_record:
        return enriched

    result = run_record.get("result") or {}
    if isinstance(result, Mapping):
        videos = result.get("videos") or []
        for item in videos:
            if not isinstance(item, Mapping):
                continue
            if item.get("index") == enriched.get("index"):
                enriched.setdefault("subject", item.get("subject"))
                enriched.setdefault("header", item.get("header"))
                break

    return enriched
