"""LangGraph workflow state definition."""

from __future__ import annotations

from typing import Any, TypedDict


class VideoWorkflowState(TypedDict, total=False):
    """State for video production workflow.

    Uses TypedDict with total=False to allow partial state updates.
    All fields are optional to support incremental updates from nodes.
    """

    # Input fields
    run_id: str
    project: str
    brief: str
    vector_db_id: str | None
    telegram_chat_id: str | None
    user_id: str | None

    # Ideation fields
    ideas: str | None
    ideas_structured: dict[str, Any] | None
    overlays: list[Any] | None
    ideas_approved: bool
    approval_comment: str | None

    # Production fields
    pending_task_ids: list[str]
    video_clips: list[str]
    production_complete: bool

    # Editing fields
    render_job_id: str | None
    final_video_url: str | None

    # Publishing fields
    publish_approved: bool
    published_urls: list[str]
    publish_status_url: str | None
    publish_complete: bool

    # Metadata fields
    status: str
    error: str | None
    current_step: str

    # Safety cache (replay-aware safety verdicts)
    safety_cache: dict[str, dict[str, object]]
