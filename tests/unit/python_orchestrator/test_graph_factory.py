from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from apps.orchestrator.graph_factory import build_project_graph, load_project_spec


def _run_with_auto_approval(graph, initial_state, thread_id: str) -> dict[str, object]:
    config = {"configurable": {"thread_id": thread_id}}
    pending: Command | dict[str, object] = initial_state
    while True:
        result = graph.invoke(pending, config=config)
        interrupt_info = result.get("__interrupt__")
        if interrupt_info:
            interrupt = interrupt_info[0]
            gate = interrupt.value.get("gate")
            pending = Command(resume={"approved": True, "gate": gate, "approver": "qa"})
            continue
        return result


def test_test_video_gen_graph_executes_sequential_personas() -> None:
    spec = load_project_spec("test_video_gen")
    builder = build_project_graph(spec, "test_video_gen")
    graph = builder.compile(checkpointer=MemorySaver())

    initial_state: dict[str, object] = {
        "run_id": "gate2-run",
        "project": "test_video_gen",
        "input": "smoke test",
        "videos": [{"subject": "mock", "header": "Mock"}],
        "persona_history": [],
        "transcript": [],
    }

    result = _run_with_auto_approval(graph, initial_state, "gate2-run")

    personas = [entry["persona"] for entry in result.get("persona_history", [])]
    assert personas == ["iggy", "riley", "alex", "quinn"], "Test Video Gen graph should run personas sequentially"
