"""Persona tool implementations for LangGraph agents."""
from __future__ import annotations

import ast
import json
import logging
import re
import tempfile
import time
from math import gcd
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from uuid import uuid4

import httpx

from adapters.ai_providers.kieai.factory import get_kieai_client as build_kieai_client
from adapters.ai_providers.shotstack.factory import get_shotstack_client as build_shotstack_client
from adapters.persistence.db.database import Database
from adapters.social.upload_post.factory import get_upload_post_client as build_upload_post_client
from content.editing.timeline import build_concatenated_timeline

from .config import settings
from .metrics import adapter_calls_total

logger = logging.getLogger("myloware.orchestrator.persona_tools")

_DB: Database | None = None
_sleep = time.sleep


_ALLOWED_SHOTSTACK_RESOLUTIONS = {"preview", "mobile", "sd", "hd", "1080", "4k"}
_RESOLUTION_PATTERN = re.compile(r"^\s*(\d+)\s*[xX]\s*(\d+)\s*$")
_DEFAULT_SOCIAL_ACCOUNT_ID = "AISMR"
_DEFAULT_SOCIAL_PROVIDER = "upload-post"


def _normalize_shotstack_timeline(timeline: Mapping[str, Any]) -> dict[str, Any]:
    """Return a copy of timeline with normalized output settings."""
    # Deep copy via JSON serialization to avoid mutating caller structures (e.g., Pydantic models)
    payload = json.loads(json.dumps(timeline))
    output_block = payload.get("output")
    if not isinstance(output_block, Mapping):
        raise ValueError(
            "Shotstack timeline missing output block. "
            "Include `output` with format/resolution/fps before calling the tool."
        )
    payload["output"] = _normalize_shotstack_output(output_block)
    return payload


def _normalize_shotstack_output(output: Mapping[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = dict(output or {})
    resolution_hint = normalized.get("resolution")
    aspect_ratio_hint = normalized.get("aspectRatio")
    resolved_resolution, inferred_aspect_ratio = _coerce_resolution_and_ratio(resolution_hint)
    if resolved_resolution:
        normalized["resolution"] = resolved_resolution
    if not aspect_ratio_hint and inferred_aspect_ratio:
        normalized["aspectRatio"] = inferred_aspect_ratio
    return normalized


def _coerce_resolution_and_ratio(resolution: Any) -> tuple[str | None, str | None]:
    if resolution is None:
        return None, None
    raw = str(resolution).strip()
    lowered = raw.lower()
    if lowered in _ALLOWED_SHOTSTACK_RESOLUTIONS:
        return lowered, None
    if lowered.isdigit():
        canonical = _bucket_resolution_from_size(int(lowered))
        return canonical, None
    match = _RESOLUTION_PATTERN.match(lowered)
    if match:
        width = int(match.group(1))
        height = int(match.group(2))
        ratio = _format_aspect_ratio(width, height)
        canonical = _bucket_resolution_from_size(max(width, height))
        return canonical, ratio
    return None, None


def _bucket_resolution_from_size(size: int) -> str:
    if size >= 2160:
        return "4k"
    if size >= 1080:
        return "1080"
    if size >= 720:
        return "hd"
    if size >= 540:
        return "sd"
    return "mobile"


def _format_aspect_ratio(width: int, height: int) -> str | None:
    if width <= 0 or height <= 0:
        return None
    divisor = gcd(width, height)
    if divisor == 0:
        return None
    return f"{width // divisor}:{height // divisor}"


def _resolve_social_account_for_run(run_id: str) -> tuple[str | None, str | None]:
    """Return (account_id, provider) for the run's primary social, if configured.

    This lets publish_to_tiktok_tool send the correct `user`/`x-social-account-id`
    to upload-post (e.g., AISMR) based on the project → social mapping.
    """
    db = _get_db()
    try:
        run_record = db.get_run(run_id)
    except Exception as exc:  # pragma: no cover - defensive; should not fail in normal flows
        logger.warning(
            "Failed to load run when resolving social account",
            extra={"runId": run_id, "error": str(exc)},
        )
        return None, None

    project: str | None = None
    if isinstance(run_record, Mapping):
        raw_project = run_record.get("project") or ""
        if raw_project:
            project = str(raw_project)
        else:
            result = run_record.get("result") or {}
            if isinstance(result, Mapping):
                raw_result_project = result.get("project") or ""
                if raw_result_project:
                    project = str(raw_result_project)

    if not project:
        return None, None

    # Not all DB stubs (e.g., in unit tests) implement socials helpers.
    if not hasattr(db, "get_primary_social_for_project"):
        return None, None

    try:
        social = db.get_primary_social_for_project(project)  # type: ignore[no-untyped-def]
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "Failed to resolve primary social for project",
            extra={"runId": run_id, "project": project, "error": str(exc)},
        )
        return None, None

    if not isinstance(social, Mapping):
        return _DEFAULT_SOCIAL_ACCOUNT_ID, _DEFAULT_SOCIAL_PROVIDER

    account_id = str(social.get("account_id") or "") or None
    provider = str(social.get("provider") or "") or None
    if not account_id:
        account_id = _DEFAULT_SOCIAL_ACCOUNT_ID
    if not provider:
        provider = _DEFAULT_SOCIAL_PROVIDER
    return account_id, provider

def _record_artifact(
    run_id: str,
    *,
    artifact_type: str,
    provider: str,
    url: str | None = None,
    checksum: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    persona: str | None = None,
) -> None:
    if not run_id:
        return
    try:
        db = _get_db()
        db.create_artifact(
            run_id=run_id,
            artifact_type=artifact_type,
            url=url,
            provider=provider,
            checksum=checksum,
            metadata=dict(metadata or {}),
            persona=persona,
        )
    except Exception as exc:  # pragma: no cover - artifact persistence must not break persona tools
        logger.warning(
            "Failed to persist artifact",
            extra={"runId": run_id, "artifact_type": artifact_type, "error": str(exc)},
        )
def _record_adapter_call(
    provider: str,
    run_id: str,
    *,
    video_index: int | None = None,
    provider_job_id: str | None = None,
    extra: Mapping[str, Any] | None = None,
) -> None:
    adapter_calls_total.labels(provider=provider, mode=settings.providers_mode).inc()
    log_extra: dict[str, Any] = {
        "provider": provider,
        "runId": run_id,
        "providers_mode": settings.providers_mode,
    }
    if video_index is not None:
        log_extra["videoIndex"] = video_index
    if provider_job_id:
        log_extra["providerJobId"] = provider_job_id
    if extra:
        log_extra.update(dict(extra))
    logger.info("Persona adapter call", extra=log_extra)


def _update_run_render_record(
    run_id: str,
    render_url: str | None,
    *,
    provider_job_id: str | None = None,
) -> None:
    """Persist render metadata on the run record so Quinn can find the final video."""
    if not render_url:
        return
    try:
        db = _get_db()
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning(
            "Failed to establish DB connection while recording render completion",
            extra={"runId": run_id, "error": str(exc)},
        )
        return
    try:
        record = db.get_run(run_id)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning(
            "Failed to load run while recording render completion",
            extra={"runId": run_id, "error": str(exc)},
        )
        return
    if not record:
        logger.warning(
            "Run missing while attempting to record render completion",
            extra={"runId": run_id},
        )
        return
    result = _coerce_result_dict(record.get("result"))
    videos = result.get("videos")
    updated_videos: list[dict[str, Any]] = []
    if isinstance(videos, list) and videos:
        for idx, video in enumerate(videos):
            entry = dict(video) if isinstance(video, Mapping) else {}
            entry.setdefault("index", entry.get("index", idx))
            entry["renderUrl"] = render_url
            entry.setdefault("status", entry.get("status") or "rendered")
            updated_videos.append(entry)
    else:
        updated_videos = [{"index": 0, "status": "rendered", "renderUrl": render_url}]
    result["videos"] = updated_videos
    render_entry = {"url": render_url, "jobId": provider_job_id}
    renders = result.get("renders")
    if isinstance(renders, list):
        deduped = [item for item in renders if item.get("url") != render_url and item.get("jobId") != provider_job_id]
        deduped.append(render_entry)
        result["renders"] = deduped
    else:
        result["renders"] = [render_entry]
    result["renderUrl"] = render_url
    result["finalRenderUrl"] = render_url
    current_status = str(record.get("status") or "generating")
    if current_status in {"published", "failed", "cancelled"}:
        new_status = current_status
    else:
        new_status = current_status or "generating"
    try:
        db.update_run(run_id=run_id, status=new_status, result=result)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning(
            "Failed to persist render metadata on run record",
            extra={"runId": run_id, "error": str(exc)},
        )


def _resolve_final_render_url_for_run(run_id: str) -> str | None:
    """Return the canonical final render URL for a run.

    Preference order (no fallbacks to raw generation clips):
    1. Most recent ``render.url`` artifact URL.
    2. ``result.finalRenderUrl`` or ``result.renderUrl`` on the run record.
    3. Any ``renderUrl``/``normalizedUrl`` found on ``result.videos[*]``.

    If none of these are present, the run is treated as missing a final render
    and callers should fail-fast instead of publishing a raw assetUrl.
    """
    try:
        db = _get_db()
    except Exception as exc:  # pragma: no cover - defensive logging only
        logger.warning(
            "Failed to establish DB connection while resolving final render URL",
            extra={"runId": run_id, "error": str(exc)},
        )
        return None

    try:
        record = db.get_run(run_id)
    except Exception as exc:  # pragma: no cover - defensive logging only
        logger.warning(
            "Failed to load run while resolving final render URL",
            extra={"runId": run_id, "error": str(exc)},
        )
        return None

    if not record:
        return None

    candidates: list[str] = []

    # Prefer URLs recorded directly on the run.result.
    result = _coerce_result_dict(record.get("result"))
    for key in ("finalRenderUrl", "renderUrl"):
        value = result.get(key)
        if value:
            candidates.append(str(value))

    videos = result.get("videos")
    if isinstance(videos, Iterable):
        for video in videos:
            if not isinstance(video, Mapping):
                continue
            # Only consider rendered/normalized URLs from videos; never treat
            # raw generation assetUrl values as canonical renders.
            for key in ("renderUrl", "normalizedUrl"):
                value = video.get(key)
                if value:
                    candidates.append(str(value))

    # Fall back to artifacts if needed; this is also where we pick up
    # Alex's Shotstack render when run.result is stale.
    try:
        artifacts = db.list_artifacts(run_id)  # type: ignore[attr-defined]
    except Exception as exc:  # pragma: no cover - defensive logging only
        logger.warning(
            "Failed to list artifacts while resolving final render URL",
            extra={"runId": run_id, "error": str(exc)},
        )
        artifacts = []

    for artifact in reversed(artifacts or []):
        if str(artifact.get("type") or "").lower() != "render.url":
            continue
        url = artifact.get("url")
        if not url:
            metadata = artifact.get("metadata") or {}
            if isinstance(metadata, Mapping):
                url = metadata.get("url") or metadata.get("renderUrl")
        if url:
            # render.url artifacts are the most authoritative; put them first.
            candidates.insert(0, str(url))
            break

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        return candidate
    return None


def submit_generation_jobs_tool(*, videos: str | Iterable[Mapping[str, Any]], run_id: str) -> str:
    """Submit video generation jobs to kie.ai and return a summary string."""

    parsed = _ensure_dict_list(videos)
    if not parsed:
        parsed = _fetch_run_videos(run_id)
    if not parsed:
        raise ValueError("videos payload must contain at least one entry")
    normalized_videos = [dict(item) for item in parsed]

    client = build_kieai_client(settings, cache=None)
    # Include run_id in callback URL so webhooks can find the run even if payload is malformed
    callback_url = f"{settings.webhook_base_url.rstrip('/')}/v1/webhooks/kieai?run_id={run_id}"
    job_ids: list[str] = []

    for idx, descriptor in enumerate(normalized_videos):
        prompt = str(
            descriptor.get("prompt")
            or descriptor.get("subject")
            or descriptor.get("header")
            or f"Video {idx}"
        )
        duration = int(descriptor.get("duration") or descriptor.get("length") or 10)
        aspect_ratio = str(descriptor.get("aspectRatio") or "9:16")
        quality = str(descriptor.get("quality") or "720p")
        # Prefer an explicit model on the descriptor, falling back to configured default.
        model = str(descriptor.get("model") or settings.kieai_model)
        metadata = dict(descriptor.get("metadata") or {})
        video_index = descriptor.get("index")
        if video_index is None:
            video_index = idx
        metadata.setdefault("videoIndex", video_index)
        try:
            log_index = int(video_index)
        except (TypeError, ValueError):
            log_index = None
        response = client.submit_job(
            prompt=prompt,
            run_id=run_id,
            callback_url=callback_url,
            duration=duration,
            aspect_ratio=aspect_ratio,
            quality=quality,
            model=model,
            metadata=metadata,
        )
        task_id: str | None = None
        data_block = None
        if isinstance(response, Mapping):
            data_block = response.get("data")
        if isinstance(data_block, Mapping) and data_block.get("taskId"):
            task_id = str(data_block["taskId"])
        if not task_id:
            error_code: Any | None = None
            error_message: str | None = None
            if isinstance(response, Mapping):
                # kie.ai error responses have been observed to return
                # {"code": 422, "msg": "Invalid model", "data": null}
                error_code = response.get("code")
                error_message = (
                    str(response.get("msg") or response.get("message") or response.get("error") or "").strip()
                    or None
                )
            _record_artifact(
                run_id,
                artifact_type="kieai.error",
                provider="kieai",
                metadata={
                    "persona": "riley",
                    "prompt": prompt,
                    "duration": duration,
                    "aspectRatio": aspect_ratio,
                    "quality": quality,
                    "model": model,
                    "videoIndex": log_index,
                    "errorCode": error_code,
                    "errorMessage": error_message,
                    "rawResponse": response,
                },
                persona="riley",
            )
            detail = ""
            if error_code is not None or error_message:
                detail_parts = []
                if error_code is not None:
                    detail_parts.append(f"code={error_code}")
                if error_message:
                    detail_parts.append(f"message={error_message}")
                detail = f" ({', '.join(detail_parts)})"
            raise ValueError(
                f"kie.ai submit_job returned no taskId for run {run_id} video {video_index}{detail}"
            )
        # At this point task_id is guaranteed non-None
        job_ids.append(task_id)
        _record_artifact(
            run_id,
            artifact_type="kieai.job",
            provider="kieai",
            metadata={
                "persona": "riley",
                "prompt": prompt,
                "duration": duration,
                "aspectRatio": aspect_ratio,
                "quality": quality,
                "model": model,
                "videoIndex": log_index,
                "taskId": task_id,
                "metadata": metadata,
            },
            persona="riley",
        )
        _record_adapter_call(
            "kieai",
            run_id,
            video_index=log_index,
            provider_job_id=task_id,
            extra={"duration": duration, "aspectRatio": aspect_ratio},
        )
    return f"Submitted {len(job_ids)} generation jobs for run {run_id}: {', '.join(job_ids)}"


def wait_for_generations_tool(
    run_id: str,
    *,
    expected_count: int,
    timeout_minutes: float = 10,
    poll_interval_seconds: float = 5,
) -> str:
    """Poll the runs table until the expected number of clips reach generated status."""

    if expected_count <= 0:
        raise ValueError("expected_count must be positive")
    if poll_interval_seconds <= 0:
        raise ValueError("poll_interval_seconds must be positive")
    if timeout_minutes < 0:
        raise ValueError("timeout_minutes cannot be negative")

    attempts = max(int((timeout_minutes * 60) / poll_interval_seconds), 1)
    ready_status = {"generated", "publishing", "published"}
    last_status = "0"
    final_count = 0
    for attempt in range(attempts):
        videos = _fetch_run_videos(run_id)
        final_count = sum(1 for video in videos if str(video.get("status", "")).lower() in ready_status)
        last_status = f"{final_count}/{expected_count}"
        if final_count >= expected_count:
            message = f"All {final_count} videos ready for run {run_id}."
            _record_artifact(
                run_id,
                artifact_type="kieai.wait",
                provider="kieai",
                metadata={
                    "persona": "riley",
                    "expectedCount": expected_count,
                    "generatedCount": final_count,
                    "status": "completed",
                    "pollIntervalSeconds": poll_interval_seconds,
                    "timeoutMinutes": timeout_minutes,
                },
                persona="riley",
            )
            return message
        if attempt < attempts - 1:
            _sleep(poll_interval_seconds)
    _record_artifact(
        run_id,
        artifact_type="kieai.wait",
        provider="kieai",
        metadata={
            "persona": "riley",
            "expectedCount": expected_count,
            "generatedCount": final_count,
            "status": "timeout",
            "latestStatus": last_status,
            "pollIntervalSeconds": poll_interval_seconds,
            "timeoutMinutes": timeout_minutes,
        },
        persona="riley",
    )
    return f"Timeout waiting for {expected_count} videos on run {run_id}; latest status {last_status}."


def _validate_shotstack_timeline_schema(timeline: Mapping[str, Any]) -> None:
    """Fail-fast validation that a dict looks like a Shotstack timeline body.

    This enforces a minimal contract aligned with Shotstack's Edit API:
    - top-level 'timeline' mapping with 'tracks' list
    - each track has 'clips' list
    - each clip has 'asset' mapping and numeric 'start'/'length'
    - top-level 'output' mapping with at least 'format' and 'resolution'
      (fps is optional but recommended)
    """

    if not isinstance(timeline, Mapping):
        raise ValueError("timeline must be an object with 'timeline' and 'output' keys")

    timeline_block = timeline.get("timeline")
    if not isinstance(timeline_block, Mapping):
        raise ValueError("timeline['timeline'] must be an object containing 'tracks'")

    tracks: Sequence[Any] | None = timeline_block.get("tracks")
    if not isinstance(tracks, Sequence) or not tracks:
        raise ValueError("timeline['timeline']['tracks'] must be a non-empty list")

    for track in tracks:
        if not isinstance(track, Mapping):
            raise ValueError("each track must be an object with 'clips'")
        clips = track.get("clips")
        if not isinstance(clips, Sequence) or not clips:
            raise ValueError("each track must contain a non-empty 'clips' list")
        for clip in clips:
            if not isinstance(clip, Mapping):
                raise ValueError("each clip must be an object")
            asset = clip.get("asset")
            if not isinstance(asset, Mapping):
                raise ValueError("each clip.asset must be an object")
            if not asset.get("type"):
                raise ValueError("each clip.asset.type is required")
            if "start" not in clip or "length" not in clip:
                raise ValueError("each clip must include numeric 'start' and 'length'")

    output = timeline.get("output")
    if not isinstance(output, Mapping):
        raise ValueError("timeline['output'] must be an object with format/resolution")
    if not output.get("format") or not output.get("resolution"):
        raise ValueError("timeline['output'] must include 'format' and 'resolution'")
    fps_value = output.get("fps")
    if fps_value is not None and not isinstance(fps_value, (int, float)):
        raise ValueError("timeline['output'].fps must be numeric if provided")


def _validate_video_clip_coverage(run_id: str, timeline: Mapping[str, Any]) -> None:
    """Ensure the timeline contains enough video clips for generated run videos.

    This enforces a semantic contract for the render helper: every generated
    video with an assetUrl in the run record must be represented by at least
    one `asset.type == "video"` clip in the Shotstack timeline. If the
    timeline omits clips for some generated videos, we fail-fast so the
    system surfaces a clear configuration error instead of silently producing
    incomplete edits.
    """
    # Fetch generated videos for this run from the DB.
    run_videos = _fetch_run_videos(run_id)
    if not run_videos:
        return
    ready_status = {"generated", "publishing", "published"}
    expected = [
        video
        for video in run_videos
        if str(video.get("status", "")).lower() in ready_status and video.get("assetUrl")
    ]
    if not expected:
        return

    # Count video clips in the timeline payload.
    tracks = timeline.get("timeline", {}).get("tracks", [])
    video_clip_count = 0
    for track in tracks:
        if not isinstance(track, Mapping):
            continue
        clips = track.get("clips") or []
        for clip in clips:
            if not isinstance(clip, Mapping):
                continue
            asset = clip.get("asset")
            if not isinstance(asset, Mapping):
                continue
            asset_type = str(asset.get("type") or "").lower()
            src = asset.get("src")
            if asset_type == "video" and src:
                video_clip_count += 1

    if video_clip_count < len(expected):
        raise ValueError(
            "Shotstack timeline includes only "
            f"{video_clip_count} video clips for {len(expected)} generated videos "
            f"on run {run_id}. Add a video clip for each generated assetUrl."
        )


def render_video_timeline_tool(
    run_id: str,
    timeline: Mapping[str, Any] | None = None,
    *,
    clips: Iterable[Mapping[str, Any]] | str | None = None,
    overlay_style: Mapping[str, Any] | None = None,
    output_settings: Mapping[str, Any] | None = None,
) -> str:
    """Submit a Shotstack timeline JSON object for rendering.

    If `timeline` is supplied, it must contain the full Shotstack payload
    (`timeline` + `output`). When omitted, this tool will automatically build a
    concatenated timeline using the generated run videos (or the optional
    `clips` payload) following the documented template.

    Args:
        run_id: Current run ID.
        timeline: Optional complete Shotstack payload.
        clips: Optional list/JSON of clip descriptors (requires `assetUrl`).
        overlay_style: Optional overrides for overlay styling when auto-building.
        output_settings: Optional overrides for Shotstack output when auto-building.

    Returns:
        Render URL or success message.
    """

    if timeline is None:
        normalized_clips = _ensure_dict_list(clips) if clips is not None else []
        if not normalized_clips:
            normalized_clips = _fetch_run_videos(run_id)
        auto_clips: list[dict[str, Any]] = []
        for idx, clip in enumerate(normalized_clips):
            asset_url = clip.get("assetUrl") or clip.get("renderUrl")
            if not asset_url:
                continue
            header = (
                clip.get("header")
                or clip.get("subject")
                or clip.get("prompt")
                or clip.get("text")
                or f"Clip {idx}"
            )
            # Primary overlay text comes from the header by default; secondary
            # overlay prefers the subject when available so we can mirror the
            # canonical two-line template (e.g., title + descriptor).
            primary_text = header
            secondary_text = clip.get("subject") or clip.get("secondaryText")
            duration = clip.get("duration")
            if duration is None:
                duration = clip.get("length") or clip.get("durationSeconds") or 8.0
            auto_clips.append(
                {
                    "assetUrl": asset_url,
                    "header": header,
                    "primaryText": primary_text,
                    "secondaryText": secondary_text,
                    "duration": float(duration),
                }
            )
        if not auto_clips:
            raise ValueError(
                "No clips with assetUrl available to build Shotstack timeline. "
                "Provide clips explicitly or call after Riley completes.")
        auto_timeline = build_concatenated_timeline(
            auto_clips,
            overlay_style=overlay_style,
            output_settings=output_settings,
        )
        normalized_timeline = _normalize_shotstack_timeline(auto_timeline)
    else:
        normalized_timeline = _normalize_shotstack_timeline(timeline)
    _validate_shotstack_timeline_schema(normalized_timeline)
    _validate_video_clip_coverage(run_id, normalized_timeline)

    # Extract clip count for metadata
    tracks = normalized_timeline.get("timeline", {}).get("tracks", [])
    clip_count = sum(len(track.get("clips", [])) for track in tracks if isinstance(track, Mapping))
    # Best-effort list of clip indexes for observability; since the helper
    # builds the full timeline JSON, we may not have explicit indexes, so we
    # default to 0..clip_count-1.
    clip_indexes = list(range(clip_count))
    _record_artifact(
        run_id,
        artifact_type="shotstack.timeline",
        provider="shotstack",
        metadata={"persona": "alex", "clipCount": clip_count, "timeline": normalized_timeline},
        persona="alex",
    )
    client = build_shotstack_client(settings, cache=None)
    try:
        render = client.render(normalized_timeline)
    except Exception as exc:
        # Persist a structured error artifact so Shotstack failures are visible
        # when inspecting run artifacts, instead of failing silently.
        _record_artifact(
            run_id,
            artifact_type="shotstack.error",
            provider="shotstack",
            metadata={
                "persona": "alex",
                "error": str(exc),
                "timeline": normalized_timeline,
            },
            persona="alex",
        )
        logger.warning(
            "Shotstack render raised exception",
            extra={"runId": run_id, "providers_mode": settings.providers_mode},
            exc_info=True,
        )
        raise
    if not render or not render.get("url"):
        raise ValueError(f"Shotstack render returned no URL for run {run_id}")
    url = render["url"]
    # Prefer an explicit job identifier for observability and downstream tooling.
    provider_job_id = (
        render.get("id")
        or render.get("timelineId")
        or render.get("taskId")
        or render.get("renderId")
    )
    if not provider_job_id:
        response_block = render.get("response")
        if isinstance(response_block, Mapping):
            provider_job_id = response_block.get("id") or response_block.get("renderId")
    if not provider_job_id:
        raise ValueError(f"Shotstack render returned no job ID for run {run_id}")
    _record_artifact(
        run_id,
        artifact_type="render.url",
        provider="shotstack",
        url=url,
        metadata={
            "persona": "alex",
            "videoIndexes": clip_indexes,
            "status": (render or {}).get("status"),
            "jobId": provider_job_id,
        },
        persona="alex",
    )
    _record_adapter_call(
        "shotstack",
        run_id,
        provider_job_id=str(provider_job_id) if provider_job_id else None,
        extra={"videoIndexes": clip_indexes, "renderStatus": (render or {}).get("status")},
    )
    _update_run_render_record(
        run_id,
        url,
        provider_job_id=str(provider_job_id) if provider_job_id else None,
    )
    if not url:
        return f"Shotstack render submitted for run {run_id}; awaiting URL."
    return f"Shotstack render submitted for run {run_id}: {url}"


def publish_to_tiktok_tool(*, caption: str, run_id: str) -> str:
    """Publish the final clip via upload-post.

    This function no longer requires the persona to select a video URL. Instead,
    it resolves the canonical final render URL for the run from the database and
    artifacts, preferring Alex's Shotstack render when available and falling
    back to the best-known asset URL only when necessary.
    """

    selected_url = _resolve_final_render_url_for_run(run_id)
    if not selected_url:
        raise RuntimeError(
            f"publish_to_tiktok_tool could not resolve a final video URL for run {run_id}. "
            "Ensure Alex's render completed successfully before publishing."
        )

    if settings.providers_mode == "mock":
        publish_url = _build_mock_publish_url(run_id, selected_url)
        metadata: dict[str, Any] = {
            "persona": "quinn",
            "caption": caption,
            "source": selected_url,
            "mock": True,
        }
        _record_artifact(
            run_id,
            artifact_type="publish.url",
            provider="upload-post",
            url=publish_url,
            metadata=metadata,
            persona="quinn",
        )
        _record_adapter_call(
            "upload-post",
            run_id,
            extra={"caption": caption, "mock": True},
        )
        _update_run_publish_record(run_id, publish_url, preferred_status="published")
        return f"Mock-published run {run_id}: {publish_url}"

    local_path, cleanup = _ensure_local_video_file(selected_url)
    account_id, social_provider = _resolve_social_account_for_run(run_id)
    client = build_upload_post_client(settings, cache=None)
    publish: dict[str, Any] | None = None
    try:
        publish = client.publish(
            video_path=local_path,
            caption=caption,
            title=caption or local_path.stem,
            platforms=["tiktok"],
            account_id=account_id,
        )
    finally:
        if cleanup:
            try:
                local_path.unlink(missing_ok=True)
            except OSError:
                pass
    publish_results = (publish or {}).get("results") or {}
    tiktok_result = publish_results.get("tiktok") or {}
    publish_url = (
        (publish or {}).get("canonicalUrl")
        or (publish or {}).get("url")
        or tiktok_result.get("url")
    )
    provider_job_id = (
        (publish or {}).get("id")
        or tiktok_result.get("publish_id")
        or publish_url
    )
    success_flag = bool((publish or {}).get("success", True))
    if not publish_url:
        fallback_suffix = provider_job_id or "pending"
        publish_url = f"upload-post://{run_id}/{fallback_suffix}"
        logger.warning(
            "Upload-post response missing canonical URL; using fallback",
            extra={
                "runId": run_id,
                "provider": "upload-post",
                "success": success_flag,
            },
        )
    _record_artifact(
        run_id,
        artifact_type="publish.url",
        provider="upload-post",
        url=publish_url,
        metadata={
            "persona": "quinn",
            "caption": caption,
            "accountId": account_id,
            "socialProvider": social_provider,
            "success": success_flag,
            "source": selected_url,
            "response": dict(publish or {}),
        },
        persona="quinn",
    )
    _record_adapter_call(
        "upload-post",
        run_id,
        provider_job_id=str(provider_job_id) if provider_job_id else None,
        extra={"caption": caption, "platforms": ["tiktok"]},
    )
    # Update runs.result.publishUrls so contract validation passes
    _update_run_publish_record(run_id, publish_url)
    return f"Published run {run_id}: {publish_url}"


def _ensure_dict_list(value: str | Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return []
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            try:
                # Handle single-quoted JSON often returned by LLMs
                parsed = ast.literal_eval(value)
            except (ValueError, SyntaxError):
                logger.warning("Unable to parse videos payload as JSON or literal; falling back to run.videos")
                return []
    elif isinstance(value, Iterable):
        parsed = value
    else:
        return []
    normalized: list[dict[str, Any]] = []
    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, Mapping):
                normalized.append(dict(item))
    return normalized


def _build_mock_publish_url(run_id: str, video_url: str | None) -> str:
    slug = ""
    if isinstance(video_url, str) and video_url:
        slug = Path(video_url).stem.strip()
    token = uuid4().hex[:6]
    base = slug or run_id.replace("-", "")[:8] or "video"
    return f"https://publish.mock/{base}-{token}"


def _update_run_publish_record(run_id: str, publish_url: str, *, preferred_status: str | None = None) -> None:
    db = _get_db()
    run_record = db.get_run(run_id)
    if not run_record:
        raise ValueError(f"Run {run_id} not found in database")
    result = _coerce_result_dict(run_record.get("result"))
    existing_urls = result.get("publishUrls") or []
    if not isinstance(existing_urls, list):
        existing_urls = []
    if publish_url not in existing_urls:
        existing_urls.append(publish_url)
    result["publishUrls"] = existing_urls
    current_status = str(run_record.get("status") or "running")
    terminal_statuses = {"completed", "published", "failed", "cancelled"}
    if preferred_status:
        new_status = preferred_status
    else:
        new_status = current_status if current_status in terminal_statuses else "published"
    db.update_run(run_id=run_id, status=new_status, result=result)


def _fetch_run_videos(run_id: str) -> list[dict[str, Any]]:
    record = _get_db().get_run(run_id)
    if not record:
        return []
    result = _coerce_result_dict(record.get("result"))
    videos = result.get("videos")
    if isinstance(videos, list):
        return [dict(video) for video in videos if isinstance(video, Mapping)]
    return []


def _coerce_result_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, Mapping):
                return dict(parsed)
        except json.JSONDecodeError:
            return {}
    return {}


def _ensure_local_video_file(source: str) -> tuple[Path, bool]:
    path = Path(source)
    if path.exists():
        return path, False
    response = httpx.get(source, timeout=30)
    response.raise_for_status()
    suffix = path.suffix or ".mp4"
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    handle.write(response.content)
    handle.flush()
    handle.close()
    return Path(handle.name), True


def _get_db() -> Database:
    global _DB
    if _DB is None:
        _DB = Database(settings.db_url)
    return _DB


__all__ = [
    "submit_generation_jobs_tool",
    "wait_for_generations_tool",
    "render_video_timeline_tool",
    "publish_to_tiktok_tool",
]
