"""LangGraph HITL (human-in-the-loop) approval helpers.

This module is the single source of truth for HITL approvals:
- Validate the run is awaiting the expected gate
- Resume the correct LangGraph interrupt (by matching interrupt metadata)
- Return the updated DB projection (runs table)
"""

from __future__ import annotations

from typing import Any, Literal, cast
from uuid import UUID

from llama_stack_client import LlamaStackClient
from langgraph.types import Command

from myloware.config import settings
from myloware.observability.audit import log_audit_event
from myloware.observability.logging import get_logger
from myloware.storage.database import get_async_session_factory
from myloware.storage.models import RunStatus
from myloware.storage.repositories import RunRepository
from myloware.telemetry import log_hitl_event
from myloware.workflows.langgraph.graph import ensure_checkpointer_initialized, get_graph
from myloware.workflows.state import WorkflowResult

logger = get_logger(__name__)

HITLGate = Literal["ideation", "publish"]


def _expected_status(gate: HITLGate) -> RunStatus:
    if gate == "ideation":
        return RunStatus.AWAITING_IDEATION_APPROVAL
    return RunStatus.AWAITING_PUBLISH_APPROVAL


async def resume_hitl_gate(
    run_id: UUID,
    gate: HITLGate,
    *,
    approved: bool,
    comment: str | None = None,
    data: dict[str, Any] | None = None,
) -> WorkflowResult:
    """Resume a HITL interrupt for a run.

    Args:
        run_id: Workflow run UUID (LangGraph thread_id).
        gate: Which gate is being approved/rejected.
        approved: Whether the gate is approved.
        comment: Optional user comment.
        data: Optional extra resume payload fields.

    Raises:
        ValueError: If the run is not in the expected status or no matching interrupt exists.
    """
    if not settings.use_langgraph_engine:
        raise ValueError("LangGraph engine is not enabled")

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        run = await run_repo.get_async(run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")

        expected = _expected_status(gate)
        if run.status != expected.value:
            raise ValueError(
                f"Run {run_id} status '{run.status}' does not match expected '{expected.value}'"
            )

    if not settings.database_url.startswith("sqlite"):
        await ensure_checkpointer_initialized()

    graph = get_graph()
    config = {"configurable": {"thread_id": str(run_id)}}
    graph_state = await graph.aget_state(config)
    interrupts = getattr(graph_state, "interrupts", None) or []

    matching = []
    for intr in interrupts:
        intr_val = getattr(intr, "value", None) or {}
        if not isinstance(intr_val, dict):
            continue
        if intr_val.get("gate") == gate:
            matching.append(intr)
            continue
        expected_wait = f"hitl_{gate}"
        if intr_val.get("waiting_for") == expected_wait:
            matching.append(intr)

    if not matching:
        raise ValueError(f"No pending {gate} interrupt found for run {run_id}")
    if len(matching) > 1:
        raise ValueError(f"Multiple pending {gate} interrupts found for run {run_id}")

    intr = matching[0]
    interrupt_id = getattr(intr, "id", None) or getattr(intr, "interrupt_id", None)
    if not interrupt_id:
        raise ValueError(f"Interrupt is missing an id for run {run_id}")

    resume_payload: dict[str, Any] = {"approved": approved}
    if comment:
        resume_payload["comment"] = comment
    if data:
        resume_payload.update(data)

    # Audit + telemetry (non-blocking).
    action = "gate_approved" if approved else "gate_rejected"
    outcome = "success" if approved else "failure"
    user_id = getattr(run, "user_id", None)
    log_audit_event(
        action=action,
        user_id=user_id,
        run_id=run_id,
        outcome=outcome,
        metadata={"gate": gate},
    )
    log_hitl_event(
        client=cast(LlamaStackClient, object()),  # unused (kept for API compatibility)
        run_id=run_id,
        gate=gate,
        action="approved" if approved else "rejected",
        user_id=user_id,
        modifications=None,
    )

    logger.info(
        "hitl_resume",
        run_id=str(run_id),
        gate=gate,
        approved=approved,
        interrupt_id=str(interrupt_id),
    )

    await graph.ainvoke(
        Command(resume={interrupt_id: resume_payload}),
        config=config,
        durability="sync",
    )

    # Return DB projection after resume (Graph wrapper should persist status/current_step).
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        updated = await run_repo.get_async(run_id)
        if updated is None:
            return WorkflowResult(
                run_id=str(run_id),
                status=RunStatus.FAILED.value,
                current_step="unknown",
                error="Run not found after HITL resume",
            )
        return WorkflowResult(
            run_id=str(run_id),
            status=str(updated.status),
            artifacts=updated.artifacts or {},
            current_step=updated.current_step,
            error=updated.error,
        )
