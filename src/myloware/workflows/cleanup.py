"""Cleanup utilities for stuck workflow runs.

Provides periodic cleanup of runs that get stuck in intermediate states
(e.g., AWAITING_VIDEO_GENERATION) due to missed webhooks or service failures.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from myloware.observability.logging import get_logger
from myloware.storage.database import get_session
from myloware.storage.models import RunStatus
from myloware.storage.repositories import RunRepository

logger = get_logger(__name__)

__all__ = [
    "timeout_stuck_runs",
    "get_stuck_runs",
    "DEFAULT_TIMEOUT_MINUTES",
]

# Default timeout for runs waiting on external services
DEFAULT_TIMEOUT_MINUTES = 60

# Statuses that indicate a run is waiting on something external
AWAITING_STATUSES = [
    RunStatus.AWAITING_VIDEO_GENERATION.value,
    RunStatus.AWAITING_RENDER.value,
]


def get_stuck_runs(
    timeout_minutes: int = DEFAULT_TIMEOUT_MINUTES,
) -> list[dict[str, Any]]:
    """Get runs that appear stuck in waiting states.

    Args:
        timeout_minutes: Minutes after which a waiting run is considered stuck

    Returns:
        List of dicts with run info: {id, status, updated_at, stuck_for_minutes}
    """
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)
    stuck_runs = []

    with get_session() as session:
        run_repo = RunRepository(session)

        # Query runs in awaiting states that haven't been updated recently
        for status in AWAITING_STATUSES:
            runs = run_repo.find_by_status_and_age(status, cutoff)
            for run in runs:
                updated_at = run.updated_at or run.created_at
                if updated_at.tzinfo is None:
                    updated_at = updated_at.replace(tzinfo=timezone.utc)

                stuck_for = datetime.now(timezone.utc) - updated_at
                stuck_runs.append(
                    {
                        "id": run.id,
                        "status": run.status,
                        "updated_at": updated_at.isoformat(),
                        "stuck_for_minutes": int(stuck_for.total_seconds() / 60),
                    }
                )

    return stuck_runs


def timeout_stuck_runs(
    timeout_minutes: int = DEFAULT_TIMEOUT_MINUTES,
    dry_run: bool = False,
) -> list[UUID]:
    """Mark stuck runs as failed with a timeout error.

    Args:
        timeout_minutes: Minutes after which a waiting run is considered stuck
        dry_run: If True, only log what would be done without making changes

    Returns:
        List of run IDs that were (or would be) timed out
    """
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)
    timed_out_ids: list[UUID] = []

    with get_session() as session:
        run_repo = RunRepository(session)

        for status in AWAITING_STATUSES:
            runs = run_repo.find_by_status_and_age(status, cutoff)

            for run in runs:
                updated_at = run.updated_at or run.created_at
                if updated_at.tzinfo is None:
                    updated_at = updated_at.replace(tzinfo=timezone.utc)

                stuck_for = datetime.now(timezone.utc) - updated_at
                stuck_minutes = int(stuck_for.total_seconds() / 60)

                if dry_run:
                    logger.info(
                        "[DRY RUN] Would timeout run %s (status=%s, stuck for %d minutes)",
                        run.id,
                        run.status,
                        stuck_minutes,
                    )
                else:
                    error_msg = (
                        f"Run timed out after {stuck_minutes} minutes waiting in {run.status}. "
                        "External service webhook may have been missed or failed."
                    )
                    run_repo.update(
                        run.id,
                        status=RunStatus.FAILED.value,
                        error=error_msg,
                    )
                    logger.warning(
                        "Timed out stuck run %s (status=%s, stuck for %d minutes)",
                        run.id,
                        run.status,
                        stuck_minutes,
                    )

                timed_out_ids.append(run.id)

        if not dry_run and timed_out_ids:
            session.commit()

    if timed_out_ids:
        logger.info(
            "Timed out %d stuck runs (dry_run=%s)",
            len(timed_out_ids),
            dry_run,
        )

    return timed_out_ids
