"""Shared helpers for manipulating RunState."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from .config import settings
from .run_state import RunState


def append_persona_message(state: RunState, persona: str, message: str, **updates: Any) -> RunState:
    """Append persona transcript/history entry and merge updates."""
    transcript = list(state.get("transcript", []))
    transcript.append(f"{persona.title()}: {message}")
    history = list(state.get("persona_history", []))
    history.append({"persona": persona, "message": message})
    updated: dict[str, Any] = dict(state)
    updated.update(updates)
    updated["current_persona"] = persona
    updated["transcript"] = transcript
    updated["persona_history"] = history
    return cast(RunState, updated)


def collect_artifacts(state: RunState, *entries: dict[str, Any]) -> list[dict[str, Any]]:
    """Collect artifacts in state and optionally sync to the API."""
    artifacts = list(state.get("artifacts", []))
    payloads: list[dict[str, Any]] = []
    for entry in entries:
        entry.setdefault("created_at", datetime.now(UTC).isoformat())
        artifacts.append(entry)
        payloads.append(entry)
    if settings.artifact_sync_enabled and payloads:
        run_id = state.get("run_id")
        if run_id:
            try:
                from .artifacts import record_artifacts

                record_artifacts(run_id, payloads)
            except Exception:  # pragma: no cover - best effort sync
                pass
    return artifacts
