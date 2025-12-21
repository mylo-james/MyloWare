"""Telemetry module - Llama Stack native event logging.

Provides custom event logging using Llama Stack's Telemetry API.

Usage:
    from myloware.telemetry import log_workflow_event, WorkflowEvent

    log_workflow_event(client, WorkflowEvent.STARTED, run_id=run_id)
"""

from myloware.telemetry.events import (
    WorkflowEvent,
    log_cost_event,
    log_hitl_event,
    log_video_generation_event,
    log_workflow_event,
)

__all__ = [
    "WorkflowEvent",
    "log_workflow_event",
    "log_video_generation_event",
    "log_hitl_event",
    "log_cost_event",
]
