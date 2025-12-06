"""Human-in-the-Loop (HITL) gate handling."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Dict, Optional
from uuid import UUID

from llama_stack_client import LlamaStackClient

from storage.models import ArtifactType, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.orchestrator import (
    WorkflowResult,
    continue_after_ideation,
    continue_after_publish_approval,
)

if TYPE_CHECKING:
    from notifications.telegram import TelegramNotifier

logger = logging.getLogger(__name__)

__all__ = [
    "approve_gate",
    "reject_gate",
    "GATE_IDEATION",
    "GATE_PUBLISH",
]

GATE_IDEATION = "ideation"
GATE_PUBLISH = "publish"

GATE_STATUS_MAP = {
    GATE_IDEATION: RunStatus.AWAITING_IDEATION_APPROVAL,
    GATE_PUBLISH: RunStatus.AWAITING_PUBLISH_APPROVAL,
}


def approve_gate(
    client: LlamaStackClient,
    run_id: UUID,
    gate: str,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    vector_db_id: str,
    content_override: Optional[str] = None,
    tools: Optional[Dict[str, Any]] = None,
    notifier: "TelegramNotifier | None" = None,
) -> WorkflowResult:
    """Approve a HITL gate and continue the workflow."""

    run = run_repo.get(run_id)
    if run is None:
        raise ValueError(f"Run {run_id} not found")

    expected_status = GATE_STATUS_MAP.get(gate)
    if expected_status is None:
        raise ValueError(f"Unknown gate: {gate}")

    if run.status != expected_status.value:
        raise ValueError(
            f"Run {run_id} status '{run.status}' does not match expected '{expected_status.value}'"
        )

    if gate == GATE_IDEATION:
        if content_override:
            run_repo.add_artifact(run_id, "ideas_original", run.artifacts.get("ideas"))
            run_repo.add_artifact(run_id, "ideas", content_override)
        return continue_after_ideation(
            client, run_id, vector_db_id, run_repo, artifact_repo, notifier
        )

    if gate == GATE_PUBLISH:
        if content_override:
            run_repo.add_artifact(run_id, "publish_override", content_override)
        return continue_after_publish_approval(
            client, run_id, vector_db_id, run_repo, artifact_repo, notifier
        )

    raise ValueError(f"Unhandled gate: {gate}")


def reject_gate(
    run_id: UUID,
    gate: str,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    reason: str = "Rejected by user",
    notifier: "TelegramNotifier | None" = None,
) -> WorkflowResult:
    """Reject a HITL gate and fail the run."""

    run = run_repo.get(run_id)
    if run is None:
        raise ValueError(f"Run {run_id} not found")

    expected_status = GATE_STATUS_MAP.get(gate)
    if expected_status is None:
        raise ValueError(f"Unknown gate: {gate}")

    if run.status != expected_status.value:
        raise ValueError(
            f"Run {run_id} status '{run.status}' does not match expected '{expected_status.value}'"
        )

    run_repo.update_status(run_id, RunStatus.FAILED)
    run_repo.add_artifact(run_id, "rejection_reason", reason)
    run_repo.add_artifact(run_id, "rejected_gate", gate)
    artifact_repo.create(
        run_id=run_id,
        persona="hitl",
        artifact_type=ArtifactType.REJECTION,
        content=reason,
        metadata={"gate": gate},
    )
    run_repo.update(run_id, error=f"Rejected at {gate} gate: {reason}")

    if notifier:
        from workflows.orchestrator import _notify_telegram

        run = run_repo.get(run_id)
        if run:
            _notify_telegram(
                run,
                notifier,
                "failed",
                error=f"Rejected at {gate} gate: {reason}",
                step=gate,
            )

    return WorkflowResult(
        run_id=run_id,
        status=RunStatus.FAILED,
        current_step=gate,
        artifacts=run.artifacts or {},
        error=reason,
    )
