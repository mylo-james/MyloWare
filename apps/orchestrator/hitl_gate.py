"""HITL gate node implementation for LangGraph interrupts."""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from langgraph.types import interrupt

from .run_state import RunState
from .state_utils import collect_artifacts

logger = logging.getLogger("myloware.orchestrator.hitl")


def hitl_gate_node(state: RunState, gate_name: str) -> RunState:
    """Pause execution at the specified gate until a human approves.

    The implementation mirrors the official LangGraph HITL pattern documented in
    https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/add-human-in-the-loop/
    where the node:

    1. Marks the gate as awaiting approval and emits a `hitl.request` artifact.
    2. Calls `interrupt(...)` to stop the graph, persisting state via the checkpointer.
    3. Resumes when `Command(resume=<payload>)` is invoked, applying the approval metadata.
    """
    run_id = state.get("run_id", "unknown")
    project = state.get("project", "unknown")
    persona = state.get("current_persona") or "system"

    logger.info(
        "HITL gate triggered",
        extra={"run_id": run_id, "gate": gate_name, "project": project, "persona": persona},
    )

    prepared_state = _ensure_gate_request_state(state, gate_name)

    interrupt_payload = {
        "gate": gate_name,
        "run_id": run_id,
        "project": project,
        "persona": persona,
        "requested_at": prepared_state.get("metadata", {}).get(f"{gate_name}_requested_at"),
        "instructions": f"Awaiting approval for {gate_name} gate.",
    }

    approval = interrupt(interrupt_payload)

    return _apply_gate_approval(prepared_state, gate_name, approval or {})


def _ensure_gate_request_state(state: RunState, gate_name: str) -> RunState:
    """Ensure awaiting_gate, metadata, and artifacts are set exactly once per gate."""
    metadata = dict(state.get("metadata", {}))
    awaiting_gate = state.get("awaiting_gate")

    if awaiting_gate != gate_name:
        metadata[f"{gate_name}_requested_at"] = datetime.now(UTC).isoformat()
        state["metadata"] = metadata
        state["awaiting_gate"] = gate_name
        state["artifacts"] = _ensure_hitl_request_artifact(state, gate_name)
    else:
        state["metadata"] = metadata
        state["awaiting_gate"] = gate_name
        state["artifacts"] = list(state.get("artifacts", []))

    return state


def _ensure_hitl_request_artifact(state: RunState, gate_name: str) -> list[dict[str, Any]]:
    artifacts = list(state.get("artifacts", []))
    has_request_artifact = any(
        artifact.get("type") == "hitl.request" and artifact.get("gate") == gate_name for artifact in artifacts
    )
    if has_request_artifact:
        return artifacts

    persona = state.get("current_persona") or "system"
    project = state.get("project")
    gate_summary = f"Awaiting approval for {gate_name} gate."
    request_artifact = {
        "type": "hitl.request",
        "persona": persona,
        "project": project,
        "gate": gate_name,
        "summary": gate_summary,
    }
    return collect_artifacts(state, request_artifact)


def _apply_gate_approval(state: RunState, gate_name: str, approval: dict[str, Any]) -> RunState:
    """Apply approval metadata and emit a `hitl.approval` artifact."""
    run_id = state.get("run_id", "unknown")
    project = state.get("project", "unknown")

    metadata = dict(state.get("metadata", {}))
    metadata[f"{gate_name}_approved_at"] = datetime.now(UTC).isoformat()

    hitl_approvals = list(state.get("hitlApprovals", []))
    approval_entry = {"gate": gate_name, **approval}
    hitl_approvals.append(approval_entry)

    state["metadata"] = metadata
    state["awaiting_gate"] = None
    state["hitlApprovals"] = hitl_approvals

    approval_artifact = {
        "type": "hitl.approval",
        "persona": approval.get("approver") or "system",
        "project": project,
        "gate": gate_name,
        "summary": f"Gate '{gate_name}' approved for run {run_id}.",
        "details": approval,
    }
    state["artifacts"] = collect_artifacts(state, approval_artifact)

    logger.info(
        "HITL gate approved",
        extra={"run_id": run_id, "gate": gate_name, "project": project, "approval": approval},
    )

    return state


def hitl_gate_prepare_node(state: RunState, gate_name: str) -> RunState:
    """Ensure HITL metadata is present before the interrupt node executes."""
    return _ensure_gate_request_state(state, gate_name)
