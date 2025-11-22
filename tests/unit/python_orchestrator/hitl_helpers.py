from __future__ import annotations

from typing import Any

from langgraph.types import Command


def run_with_auto_hitl(graph, initial_state: dict[str, Any], thread_id: str) -> tuple[dict[str, Any], list[str]]:
    """Execute a graph, auto-approving HITL gates and returning final state plus gate order."""
    config = {"configurable": {"thread_id": thread_id}}
    pending: Command | dict[str, object] = initial_state
    gates: list[str] = []
    while True:
        result = graph.invoke(pending, config=config)
        interrupt_info = result.get("__interrupt__")
        if interrupt_info:
            interrupt = interrupt_info[0]
            gate = interrupt.value.get("gate")
            assert gate in {"ideate", "prepublish"}
            assert result.get("awaiting_gate") == gate
            assert interrupt.value.get("run_id") == initial_state.get("run_id")
            assert interrupt.value.get("project") == initial_state.get("project")
            gates.append(gate)
            pending = Command(resume={"approved": True, "gate": gate, "approver": "qa"})
            continue
        return result, gates
