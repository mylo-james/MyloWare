"""RunState TypedDict for production graphs."""
from __future__ import annotations

from typing import Any, TypedDict


class RunState(TypedDict, total=False):
    """State for production graph runs.
    
    Uses run_id as thread_id for checkpointing.
    """
    run_id: str
    project: str
    input: str
    videos: list[dict[str, Any]]
    model: str
    metadata: dict[str, Any]
    current_persona: str
    next_persona: str | None
    persona_history: list[dict[str, Any]]
    transcript: list[str]
    completed: bool
    totalVideos: int
    awaiting_gate: str | None
    retrieval_traces: list[dict[str, Any]]
    citations: list[dict[str, Any]]
    artifacts: list[dict[str, Any]]
    modifiers: list[str]
    scripts: list[dict[str, Any]]
    clips: list[dict[str, Any]]
    renders: list[dict[str, Any]]
    publishUrls: list[str]
    hitlApprovals: list[dict[str, Any]]
    stage: str | None
    options: dict[str, Any]
    project_spec: dict[str, Any]
    scenarios: list[dict[str, Any]]
