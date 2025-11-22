"""Helpers for observing LangGraph run snapshots and summarising persona progress."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence, cast

import httpx

from .config import settings

logger = logging.getLogger("myloware.orchestrator.run_observer")

RUN_SNAPSHOT_FETCHER = Callable[[str], Mapping[str, Any]]


@dataclass
class ObservationResult:
    """Structured output returned by ``observe_run_progress``."""

    message: str
    updates: dict[str, Any]
    flags: dict[str, Any]


_RUN_CLIENT: httpx.Client | None = None


def _api_client() -> httpx.Client:
    global _RUN_CLIENT
    if _RUN_CLIENT is None:
        _RUN_CLIENT = httpx.Client(timeout=5.0)
    return _RUN_CLIENT


def _ensure_mapping(value: Any) -> dict[str, Any]:
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


def _get_run_snapshot(run_id: str) -> dict[str, Any]:
    client = _api_client()
    base_url = settings.api_base_url.rstrip("/")
    response = client.get(
        f"{base_url}/v1/runs/{run_id}",
        headers={"x-api-key": settings.api_key},
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, Mapping):
        raise ValueError("Unexpected run response")
    return cast(dict[str, Any], data)


def format_status_summary(videos: list[Mapping[str, Any]]) -> str:
    if not videos:
        return "no clips recorded yet"
    stats: dict[str, int] = {}
    for video in videos:
        status = str(video.get("status") or "pending").lower()
        stats[status] = stats.get(status, 0) + 1
    return ", ".join(f"{status}: {count}" for status, count in sorted(stats.items()))


def extract_render_url_from_artifacts(artifacts: Sequence[Mapping[str, Any]]) -> str | None:
    for artifact in reversed(list(artifacts or [])):
        if str(artifact.get("type") or "").lower() != "render.url":
            continue
        url = artifact.get("url")
        if url:
            return str(url)
        metadata = artifact.get("metadata")
        if isinstance(metadata, Mapping):
            meta_url = metadata.get("url") or metadata.get("renderUrl")
            if meta_url:
                return str(meta_url)
    return None


def derive_persona_updates(
    *,
    persona: str,
    project: str,
    run_id: str,
    run_result: Mapping[str, Any],
    artifacts: list[Mapping[str, Any]],
) -> tuple[dict[str, Any], str]:
    videos = [dict(video) for video in run_result.get("videos") or [] if isinstance(video, Mapping)]
    latest_render_url = extract_render_url_from_artifacts(artifacts)
    if latest_render_url:
        for video in videos:
            video.setdefault("renderUrl", latest_render_url)
    publish_urls = [str(url) for url in run_result.get("publishUrls") or [] if url]
    updates: dict[str, Any] = {
        "videos": videos,
        "publishUrls": publish_urls,
        "run_result": dict(run_result),
        "run_snapshot": {
            "run_id": run_id,
            "result": dict(run_result),
            "artifacts": artifacts,
        },
    }
    if artifacts:
        updates["observed_artifacts"] = artifacts
    if latest_render_url:
        updates["render_url"] = latest_render_url

    persona_key = persona.lower()
    if persona_key == "iggy":
        if project == "test_video_gen":
            storyboards: list[dict[str, Any]] = []
            for video in videos:
                idx = video.get("index", len(storyboards))
                concept = str(video.get("prompt") or video.get("header") or video.get("subject") or "Storyboard")
                storyboards.append(
                    {
                        "index": idx,
                        "subject": video.get("subject"),
                        "header": video.get("header"),
                        "concept": concept,
                    }
                )
            if storyboards:
                updates["storyboards"] = storyboards
        else:
            modifiers = [str(video.get("header")) for video in videos if video.get("header")]
            if modifiers:
                updates["modifiers"] = modifiers
    elif persona_key == "riley":
        scripts: list[dict[str, Any]] = []
        clips: list[dict[str, Any]] = []
        for video in videos:
            idx = video.get("index", len(scripts))
            prompt = str(video.get("prompt") or video.get("header") or video.get("subject") or "Video script")
            duration = float(video.get("duration") or run_result.get("videoDuration") or 8.0)
            scripts.append({"index": idx, "text": prompt, "durationSeconds": duration})
            clips.append(
                {
                    "index": idx,
                    "status": video.get("status") or "pending",
                    "assetUrl": video.get("assetUrl"),
                }
            )
        if scripts:
            updates["scripts"] = scripts
        if clips:
            updates["clips"] = clips
    elif persona_key == "alex":
        renders: list[dict[str, Any]] = []
        clips: list[dict[str, Any]] = []
        for video in videos:
            idx = video.get("index", len(renders))
            base_entry = {"index": idx, "status": video.get("status") or "pending"}
            render_url = video.get("renderUrl") or video.get("assetUrl") or video.get("publishUrl")
            if render_url:
                renders.append({**base_entry, "renderUrl": render_url})
            clips.append({**base_entry, "assetUrl": video.get("assetUrl")})
        if renders:
            updates["renders"] = renders
        if clips:
            updates["clips"] = clips
    elif persona_key == "quinn" and publish_urls:
        updates["publishUrls"] = publish_urls
        updates["completed"] = True

    status_text = format_status_summary(videos)
    if persona_key == "quinn" and publish_urls:
        message = f"Observed {len(publish_urls)} publish URLs for run {run_id}; clip statuses: {status_text}."
    elif persona_key == "alex":
        measured = len(updates.get("renders") or updates.get("clips") or [])
        message = f"Observed {measured} normalized clips for run {run_id}; statuses: {status_text}."
    elif persona_key == "riley":
        message = f"Observed {len(updates.get('scripts') or [])} scripts for run {run_id}; clip statuses: {status_text}."
    else:
        message = f"Observed {len(videos)} clips for run {run_id}; statuses: {status_text}."
    return updates, message


def observe_run_progress(
    *,
    persona: str,
    project: str,
    state: Mapping[str, Any],
    fetch_snapshot: RUN_SNAPSHOT_FETCHER | None = None,
) -> ObservationResult:
    run_id = state.get("run_id")
    if not run_id:
        return ObservationResult(
            message="No run ID assigned yet; waiting for the pipeline to start.",
            updates={},
            flags={}
        )
    fetcher = fetch_snapshot or _get_run_snapshot
    try:
        snapshot = fetcher(str(run_id))
    except Exception as exc:  # pragma: no cover - network errors
        logger.warning(
            "Failed to load run snapshot",
            extra={"run_id": run_id, "persona": persona, "error": str(exc)},
        )
        return ObservationResult(
            message=f"Unable to load run {run_id}; retry after pipeline updates ({exc}).",
            updates={},
            flags={
                "run_snapshot_error": str(exc),
                "persona_contract_waived": True,
            },
        )

    run_result = _ensure_mapping(snapshot.get("result"))
    artifacts_raw = snapshot.get("artifacts") or []
    artifacts = [dict(item) for item in artifacts_raw if isinstance(item, Mapping)]
    updates, message = derive_persona_updates(
        persona=persona,
        project=project,
        run_id=str(run_id),
        run_result=run_result,
        artifacts=artifacts,
    )
    return ObservationResult(message=message, updates=updates, flags={})
