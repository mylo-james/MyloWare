"""Audit logging helper for workflow events and gate decisions.

Provides a fire-and-forget pattern that logs audit events without
blocking request processing. Failures are logged but never propagate.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from myloware.observability.logging import get_logger
from myloware.storage.database import get_session
from myloware.storage.repositories import AuditLogRepository

logger = get_logger(__name__)

__all__ = ["log_audit_event"]


def log_audit_event(
    action: str,
    user_id: str | None = None,
    run_id: UUID | None = None,
    duration_ms: int | None = None,
    outcome: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Log audit event without blocking.

    Failures are logged but don't propagate - audit failures should never
    block request processing.

    Args:
        action: Event type (e.g., "workflow_started", "gate_approved")
        user_id: Optional user identifier
        run_id: Optional workflow run ID
        duration_ms: Optional duration in milliseconds
        outcome: Optional outcome ("success", "failure")
        metadata: Optional additional context
    """
    try:
        with get_session() as session:
            repo = AuditLogRepository(session)
            repo.create(
                action=action,
                user_id=user_id,
                run_id=run_id,
                duration_ms=duration_ms,
                outcome=outcome,
                metadata=metadata or {},
            )
    except Exception as e:
        # Log error but never re-raise - audit failures shouldn't block requests
        logger.error(
            "audit_log_failed",
            action=action,
            user_id=user_id,
            run_id=str(run_id) if run_id else None,
            error=str(e),
        )
