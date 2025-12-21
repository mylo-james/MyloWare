"""Llama Stack native telemetry events.

NOTE: Llama Stack 0.3.x Telemetry API is read-only (query spans/traces).
Event logging is handled server-side via OpenTelemetry integration.

These functions log events via structlog instead, which can be forwarded
to observability backends via log aggregation pipelines.

Usage:
    from myloware.telemetry.events import log_workflow_event, WorkflowEvent

    log_workflow_event(client, WorkflowEvent.STARTED, run_id=run_id, workflow="aismr")
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict
from uuid import UUID

from llama_stack_client import LlamaStackClient

from myloware.observability.logging import get_logger

logger = get_logger(__name__)

__all__ = [
    "WorkflowEvent",
    "log_workflow_event",
    "log_video_generation_event",
    "log_hitl_event",
    "log_cost_event",
]


class WorkflowEvent(str, Enum):
    """Workflow lifecycle events."""

    STARTED = "workflow_started"
    IDEATION_COMPLETE = "workflow_ideation_complete"
    PRODUCTION_STARTED = "workflow_production_started"
    PRODUCTION_COMPLETE = "workflow_production_complete"
    EDITING_COMPLETE = "workflow_editing_complete"
    PUBLISHING_COMPLETE = "workflow_publishing_complete"
    COMPLETED = "workflow_completed"
    FAILED = "workflow_failed"
    CANCELLED = "workflow_cancelled"


def _get_timestamp() -> str:
    """Get ISO timestamp."""
    return datetime.now(timezone.utc).isoformat()


def log_workflow_event(
    client: LlamaStackClient,  # noqa: ARG001 - kept for API compatibility
    event: WorkflowEvent,
    run_id: UUID | str,
    workflow: str | None = None,
    step: str | None = None,
    error: str | None = None,
    duration_ms: int | None = None,
    extra: Dict[str, Any] | None = None,
) -> None:
    """Log a workflow lifecycle event.

    Note: Llama Stack 0.3.x Telemetry API is read-only.
    Events are logged via structlog for log aggregation pipelines.

    Args:
        client: Llama Stack client (unused, kept for API compatibility)
        event: Workflow event type
        run_id: Run identifier
        workflow: Workflow name (e.g., "aismr")
        step: Current step (e.g., "ideator", "producer")
        error: Error message if failed
        duration_ms: Duration in milliseconds
        extra: Additional attributes
    """
    log_data: Dict[str, Any] = {
        "run_id": str(run_id),
        "event_type": "workflow",
        "event_name": event.value,
        "timestamp": _get_timestamp(),
    }

    if workflow:
        log_data["workflow"] = workflow
    if step:
        log_data["step"] = step
    if error:
        log_data["error"] = error[:500]
    if duration_ms is not None:
        log_data["duration_ms"] = duration_ms
    if extra:
        log_data.update(extra)

    logger.info("workflow_event", **log_data)


def log_video_generation_event(
    client: LlamaStackClient,  # noqa: ARG001 - kept for API compatibility
    run_id: UUID | str,
    clip_count: int,
    provider: str = "openai sora",
    estimated_cost_usd: float | None = None,
    cached_clips: int = 0,
    topic: str | None = None,
) -> None:
    """Log video generation start event with cost tracking.

    Args:
        client: Llama Stack client (unused, kept for API compatibility)
        run_id: Run identifier
        clip_count: Number of clips being generated
        provider: Video generation provider
        estimated_cost_usd: Estimated cost in USD
        cached_clips: Number of clips from cache (free)
        topic: Content topic
    """
    log_data: Dict[str, Any] = {
        "run_id": str(run_id),
        "event_type": "video_generation",
        "event_name": "video_generation_started",
        "timestamp": _get_timestamp(),
        "clip_count": clip_count,
        "provider": provider,
        "cached_clips": cached_clips,
        "new_clips": clip_count - cached_clips,
    }

    if estimated_cost_usd is not None:
        log_data["estimated_cost_usd"] = estimated_cost_usd
    if topic:
        log_data["topic"] = topic

    logger.info("video_generation_event", **log_data)


def log_hitl_event(
    client: LlamaStackClient,  # noqa: ARG001 - kept for API compatibility
    run_id: UUID | str,
    gate: str,
    action: str,  # "approved", "rejected", "modified"
    user_id: str | None = None,
    wait_time_ms: int | None = None,
    modifications: str | None = None,
) -> None:
    """Log human-in-the-loop gate events.

    Args:
        client: Llama Stack client (unused, kept for API compatibility)
        run_id: Run identifier
        gate: Gate name (e.g., "ideation", "publish")
        action: Action taken (approved/rejected/modified)
        user_id: User who took action
        wait_time_ms: Time waited for approval
        modifications: Description of modifications if any
    """
    log_data: Dict[str, Any] = {
        "run_id": str(run_id),
        "event_type": "hitl",
        "event_name": f"hitl_{action}",
        "timestamp": _get_timestamp(),
        "gate": gate,
        "action": action,
    }

    if user_id:
        log_data["user_id"] = user_id
    if wait_time_ms is not None:
        log_data["wait_time_ms"] = wait_time_ms
    if modifications:
        log_data["modifications"] = modifications[:200]

    logger.info("hitl_event", **log_data)


def log_cost_event(
    client: LlamaStackClient,  # noqa: ARG001 - kept for API compatibility
    run_id: UUID | str,
    service: str,
    cost_usd: float,
    operation: str,
    details: Dict[str, Any] | None = None,
) -> None:
    """Log cost tracking event.

    Args:
        client: Llama Stack client (unused, kept for API compatibility)
        run_id: Run identifier
        service: Service name (e.g., "openai sora", "openai", "together")
        cost_usd: Cost in USD
        operation: Operation type (e.g., "video_generation", "embedding")
        details: Additional cost details
    """
    log_data: Dict[str, Any] = {
        "run_id": str(run_id),
        "event_type": "cost",
        "event_name": "cost_incurred",
        "timestamp": _get_timestamp(),
        "service": service,
        "cost_usd": cost_usd,
        "operation": operation,
    }

    if details:
        log_data.update(details)

    logger.info("cost_event", **log_data)
