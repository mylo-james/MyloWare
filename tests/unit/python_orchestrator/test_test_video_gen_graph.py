from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from apps.orchestrator import persona_nodes
from apps.orchestrator.graph_factory import build_project_graph, load_project_spec


def test_test_video_gen_graph_produces_mock_artifacts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        persona_nodes,
        "_validate_persona_contract",
        lambda *args, **kwargs: None,
        raising=False,
    )
    project_spec = load_project_spec("test_video_gen")
    graph = build_project_graph(project_spec, "test_video_gen").compile(checkpointer=MemorySaver())

    run_id = "run-tvg-001"
    initial_state = {
        "run_id": run_id,
        "project": "test_video_gen",
        "input": "Create a pair of stylish clips.",
        "videos": [
            {"subject": "candles", "header": "Scene 1"},
            {"subject": "books", "header": "Scene 2"},
        ],
        "metadata": {},
        "persona_history": [],
        "transcript": [],
    }
    config = {"configurable": {"thread_id": run_id}}

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
            assert interrupt.value.get("run_id") == run_id
            assert interrupt.value.get("project") == "test_video_gen"
            gates.append(gate)
            pending = Command(resume={"approved": True, "gate": gate, "approver": "qa"})
            continue
        break

    assert set(gates).issubset({"ideate", "prepublish"})
    assert result.get("awaiting_gate") in (None, "")
    personas = [entry["persona"] for entry in result.get("persona_history", [])]
    assert personas == ["iggy", "riley", "alex", "quinn"]

    assert result.get("videos")
    assert result.get("publishUrls")
    assert result["publishUrls"][0].startswith("https://publish.example/run-tvg-001/")
    assert result.get("completed") is True
