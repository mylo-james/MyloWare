"""Human-in-the-Loop (HITL) gate handling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, Optional
from uuid import UUID

from llama_stack_client import LlamaStackClient

from myloware.observability.audit import log_audit_event
from myloware.observability.logging import get_logger
from myloware.storage.models import ArtifactType, RunStatus
from myloware.storage.repositories import ArtifactRepository, RunRepository
from myloware.telemetry import log_hitl_event
from myloware.workflows.state import WorkflowResult

if TYPE_CHECKING:
    from myloware.notifications.telegram import TelegramNotifier

logger = get_logger(__name__)

__all__ = [
    "approve_gate",
    "reject_gate",
    "GATE_IDEATION",
    "GATE_PUBLISH",
    "GateApprovalContext",
]

GATE_IDEATION = "ideation"
GATE_PUBLISH = "publish"

GATE_STATUS_MAP = {
    GATE_IDEATION: RunStatus.AWAITING_IDEATION_APPROVAL,
    GATE_PUBLISH: RunStatus.AWAITING_PUBLISH_APPROVAL,
}


@dataclass
class GateApprovalContext:
    """Context for HITL gate approval operations.

    Groups all the parameters needed for gate approval into a single object,
    improving readability and making it easier to pass around.

    Attributes:
        client: Llama Stack client for agent operations
        run_id: UUID of the workflow run
        gate: Gate name (GATE_IDEATION or GATE_PUBLISH)
        run_repo: Repository for run data
        artifact_repo: Repository for artifacts
        vector_db_id: ID of the vector database for RAG
        content_override: Optional replacement content for the gate output
        tools: Optional tools configuration (reserved for future use)
        notifier: Optional Telegram notifier for status updates
    """

    client: LlamaStackClient
    run_id: UUID
    gate: str
    run_repo: RunRepository
    artifact_repo: ArtifactRepository
    vector_db_id: str
    content_override: Optional[str] = None
    tools: Optional[Dict[str, Any]] = None
    notifier: "TelegramNotifier | None" = None


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
    request_id: str | None = None,
    *,
    context: Optional[GateApprovalContext] = None,
    **_kwargs: Any,
) -> WorkflowResult:
    """Approve a HITL gate and continue the workflow.

    Args:
        client: Llama Stack client (ignored if context provided)
        run_id: Run UUID (ignored if context provided)
        gate: Gate name (ignored if context provided)
        run_repo: Run repository (ignored if context provided)
        artifact_repo: Artifact repository (ignored if context provided)
        vector_db_id: Vector DB ID (ignored if context provided)
        content_override: Optional content replacement (ignored if context provided)
        tools: Optional tools config (ignored if context provided)
        notifier: Optional notifier (ignored if context provided)
        context: GateApprovalContext containing all parameters (preferred)

    Returns:
        WorkflowResult with updated status
    """
    # Use context if provided, otherwise use individual params
    if context is not None:
        client = context.client
        run_id = context.run_id
        gate = context.gate
        run_repo = context.run_repo
        content_override = context.content_override
        # request_id is optional; ignore if not provided
        request_id = getattr(context, "request_id", request_id)

    run = run_repo.get(run_id)
    if run is None:
        raise ValueError(f"Run {run_id} not found")

    expected_status = GATE_STATUS_MAP.get(gate)
    if expected_status is None:
        raise ValueError(f"Unknown gate: {gate}")

    if run.status != expected_status.value:
        from myloware.config import settings

        if not settings.disable_background_workflows:
            raise ValueError(
                f"Run {run_id} status '{run.status}' does not match expected '{expected_status.value}'"
            )

    # Audit: gate approved
    log_audit_event(
        action="gate_approved",
        user_id=run.user_id,
        run_id=run_id,
        outcome="success",
        metadata={"gate": gate, "has_override": bool(content_override)},
    )

    # Telemetry: HITL gate approved (Llama Stack native)
    log_hitl_event(
        client,
        run_id=run_id,
        gate=gate,
        action="approved",
        user_id=run.user_id,
        modifications="content_override" if content_override else None,
    )

    if gate == GATE_IDEATION:
        if content_override:
            run_repo.add_artifact(run_id, "ideas_original", run.artifacts.get("ideas"))
            run_repo.add_artifact(run_id, "ideas", content_override)
        # LangGraph resume is handled asynchronously by the caller (API route)
        return WorkflowResult(
            run_id=str(run_id),
            status=RunStatus.AWAITING_IDEATION_APPROVAL.value,
            current_step="ideation",
            artifacts=run.artifacts,
            error=None,
        )

    if gate == GATE_PUBLISH:
        if content_override:
            run_repo.add_artifact(run_id, "publish_override", content_override)
        return WorkflowResult(
            run_id=str(run_id),
            status=RunStatus.AWAITING_PUBLISH_APPROVAL.value,
            current_step="publish_approval",
            artifacts=run.artifacts,
            error=None,
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
    """Reject a HITL gate and mark the run rejected."""

    run = run_repo.get(run_id)
    if run is None:
        raise ValueError(f"Run {run_id} not found")

    expected_status = GATE_STATUS_MAP.get(gate)
    if expected_status is None:
        raise ValueError(f"Unknown gate: {gate}")

    if run.status != expected_status.value:
        from myloware.config import settings

        if not settings.disable_background_workflows:
            raise ValueError(
                f"Run {run_id} status '{run.status}' does not match expected '{expected_status.value}'"
            )

    run_repo.update_status(run_id, RunStatus.REJECTED)
    run_repo.update_step(run_id, gate)
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

    # Audit: gate rejected
    log_audit_event(
        action="gate_rejected",
        user_id=run.user_id,
        run_id=run_id,
        outcome="failure",
        metadata={"gate": gate, "reason": reason},
    )

    if notifier:
        from myloware.workflows.helpers import notify_telegram

        refreshed_run = run_repo.get(run_id)
        if refreshed_run:
            notify_telegram(
                refreshed_run,
                notifier,
                "failed",
                error=f"Rejected at {gate} gate: {reason}",
                step=gate,
            )

    refreshed_run = run_repo.get(run_id)

    return WorkflowResult(
        run_id=str(run_id),
        status=RunStatus.REJECTED.value,
        current_step=gate,
        artifacts=(refreshed_run.artifacts if refreshed_run else run.artifacts) or {},
        error=reason,
    )
