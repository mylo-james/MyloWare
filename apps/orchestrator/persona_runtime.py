"""Shared helpers for persona state resolution and deterministic fallbacks."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Mapping, MutableMapping

from content.editing.timeline import build_concatenated_timeline
from .state_utils import append_persona_message, collect_artifacts
from . import persona_tools

logger = logging.getLogger("myloware.orchestrator.persona_runtime")


def count_artifacts_of_type(state: Mapping[str, Any], artifact_type: str) -> int:
    artifacts = state.get("artifacts")
    if not isinstance(artifacts, list):
        return 0
    return sum(1 for entry in artifacts if isinstance(entry, Mapping) and entry.get("type") == artifact_type)


def load_project_spec_fallback(project: str) -> dict[str, Any]:
    base = Path(__file__).resolve().parents[2] / "data" / "projects"
    primary = base / project / "project.json"
    candidates = [primary, base / f"{project}.json"]
    for candidate in candidates:
        if candidate.exists():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                logger.warning(
                    "Failed to load project spec fallback",
                    extra={"project": project, "path": str(candidate)}
                )
    return {"workflow": ["iggy", "riley", "alex", "quinn"], "guardrails": {}}


def resolve_project_spec_for_state(state: MutableMapping[str, Any], project: str) -> dict[str, Any]:
    spec = state.get("project_spec")
    if isinstance(spec, dict) and spec:
        return spec
    fallback = load_project_spec_fallback(project)
    state["project_spec"] = fallback
    return fallback


def handle_optional_persona(persona: str, state: MutableMapping[str, Any]) -> MutableMapping[str, Any] | None:
    if persona.lower() != "morgan":
        return None

    mixes: list[dict[str, Any]] = []
    clips = state.get("clips") or state.get("renders") or []
    if clips:
        for clip in clips:
            mixes.append(
                {
                    "index": clip.get("index"),
                    "source": clip.get("assetUrl") or clip.get("renderUrl"),
                    "treatment": "spatial audio blend",
                }
            )
    else:
        mixes.append({"index": 0, "source": "prompt", "treatment": "ambient loop"})
    artifacts = collect_artifacts(
        state,
        {
            "type": "sound.design",
            "persona": "morgan",
            "items": mixes,
        },
    )
    return append_persona_message(
        state,
        "morgan",
        "Crafted custom soundtrack cues.",
        soundDesign=mixes,
        artifacts=artifacts,
    )


def _latest_artifact_url(run_id: str, artifact_type: str) -> str | None:
    try:
        db = persona_tools._get_db()  # type: ignore[attr-defined]
    except Exception:
        return None
    try:
        artifacts = db.list_artifacts(run_id)
    except Exception:
        return None
    for artifact in reversed(artifacts):
        if artifact.get("type") == artifact_type:
            url = artifact.get("url")
            if url:
                return url
            metadata = artifact.get("metadata") or {}
            if isinstance(metadata, Mapping):
                maybe = metadata.get("url") or metadata.get("renderUrl")
                if maybe:
                    return str(maybe)
    return None


def _mock_mark_videos_generated(run_id: str, videos: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """
    Mark videos as generated in mock mode.
    
    This function attempts to update the database if available, but falls back
    to in-memory mocking if the database is not accessible (e.g., in unit tests).
    """
    try:
        db = persona_tools._get_db()  # type: ignore[attr-defined]
        record = db.get_run(run_id)
    except Exception:
        # Database not available (unit tests, etc.) - use in-memory mock
        record = None
    
    if not record:
        # No database record - generate mock videos from input
        normalized: list[dict[str, Any]] = []
        for idx, video in enumerate(videos):
            entry = dict(video)
            entry.setdefault("index", idx)
            entry.setdefault("subject", entry.get("subject") or f"Clip {idx}")
            entry.setdefault("header", entry.get("header") or f"Header {idx}")
            entry["status"] = "generated"
            entry.setdefault("assetUrl", f"https://assets.mock/{run_id}-{idx}.mp4")
            normalized.append(entry)
        return normalized
    
    # Database available - update and return
    result = persona_tools._coerce_result_dict(record.get("result"))  # type: ignore[attr-defined]
    source = list(videos) or result.get("videos") or []
    normalized = []
    for idx, video in enumerate(source):
        entry = dict(video)
        entry.setdefault("index", idx)
        entry.setdefault("subject", entry.get("subject") or f"Clip {idx}")
        entry.setdefault("header", entry.get("header") or f"Header {idx}")
        entry["status"] = "generated"
        entry.setdefault("assetUrl", f"https://assets.mock/{run_id}-{idx}.mp4")
        normalized.append(entry)
    result["videos"] = normalized
    result["totalVideos"] = len(normalized)
    try:
        db.update_run(run_id=run_id, status="generating", result=result)
    except Exception:
        logger.debug("Skipping DB update for mock videos", extra={"run_id": run_id})
    return normalized


def run_mock_persona(
    persona: str,
    project: str,
    project_spec: Mapping[str, Any],
    state: MutableMapping[str, Any],
) -> tuple[str, dict[str, Any]]:
    run_id = str(state.get("run_id") or "")
    videos = state.get("videos") or []
    target_count = int((project_spec.get("specs") or {}).get("videoCount") or len(videos) or 2)
    actions: list[str] = []
    updates: dict[str, Any] = {}

    if persona == "iggy":
        storyboards: list[dict[str, Any]] = []
        for idx in range(target_count):
            source = videos[idx % len(videos)] if videos else {"subject": f"subject {idx+1}", "header": f"header {idx+1}"}
            storyboards.append(
                {
                    "index": idx,
                    "subject": source.get("subject"),
                    "header": source.get("header"),
                    "concept": source.get("prompt") or source.get("subject") or f"Storyboard {idx+1}",
                }
            )
        updates["videos"] = storyboards
        updates["storyboards"] = storyboards
        actions.append("Storyboarded clips and briefed Riley.")
    elif persona == "riley":
        payload = json.dumps(videos or [{"index": 0, "prompt": "Test clip", "duration": 8}])
        try:
            actions.append(persona_tools.submit_generation_jobs_tool(videos=payload, run_id=run_id))
        except Exception as exc:
            actions.append(f"Mocked submission (error: {exc})")
        generated = _mock_mark_videos_generated(run_id, videos)
        try:
            wait_message = persona_tools.wait_for_generations_tool(
                run_id,
                expected_count=len(generated) or 1,
                timeout_minutes=0.05,
                poll_interval_seconds=0.01,
            )
        except Exception as exc:
            wait_message = f"Mocked wait (error: {exc})"
        actions.append(wait_message)
        updates["videos"] = generated
        actions.append("Mocked scripts and kie.ai run.")
    elif persona == "alex":
        clips = state.get("clips") or videos
        enriched_clips: list[dict[str, Any]] = []
        for idx, clip in enumerate(clips):
            enriched_clips.append(
                {
                    "index": idx,
                    "assetUrl": clip.get("assetUrl") or f"https://assets.example/{run_id}-{idx}.mp4",
                    "header": clip.get("header") or clip.get("prompt") or f"Clip {idx + 1}",
                    "subject": clip.get("subject"),
                    "duration": float(clip.get("duration") or 8),
                }
            )
        if enriched_clips:
            try:
                timeline = build_concatenated_timeline(enriched_clips)
                actions.append(persona_tools.render_video_timeline_tool(run_id, timeline))
            except Exception as exc:
                actions.append(f"Mocked render (error: {exc})")
        render_url = _latest_artifact_url(run_id, "render.url") or f"https://assets.example/variant/{run_id}/{len(clips or [])}.mp4"
        renders = [
            {"index": clip.get("index", idx), "status": "rendered", "renderUrl": render_url}
            for idx, clip in enumerate(clips or videos or [])
        ]
        updates["renders"] = renders
        updates["render_url"] = render_url
        actions.append("Mock handoff to Quinn.")
    elif persona == "quinn":
        render_url = state.get("render_url") or _latest_artifact_url(run_id, "render.url")
        try:
            publish_message = persona_tools.publish_to_tiktok_tool(
                render_url or f"https://mock.video.myloware/{run_id}-final.mp4",
                caption=f"{project} mock run",
                run_id=run_id,
            )
        except Exception as exc:
            publish_message = f"Mocked publish (error: {exc})"
        actions.append(publish_message)
        publish_url = _latest_artifact_url(run_id, "publish.url") or f"https://publish.example/{run_id}/0"
        updates["publishUrls"] = [publish_url]
        updates["completed"] = True
    else:
        actions.append(f"Executed mock persona flow for {persona}.")

    summary = " ".join(action for action in actions if action).strip()
    if not summary:
        summary = f"{persona} mock step complete."
    return summary, updates
