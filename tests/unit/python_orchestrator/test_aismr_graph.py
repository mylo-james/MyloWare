from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from apps.orchestrator.graph_factory import build_project_graph, load_project_spec


def test_aismr_graph_produces_mock_artifacts_and_guardrails() -> None:
    project_spec = load_project_spec("aismr")
    assert project_spec.get("workflow") == ["brendan", "iggy", "riley", "alex", "quinn"]
    assert set(project_spec.get("hitlPoints") or []) == {"after_iggy", "before_quinn"}

    graph = build_project_graph(project_spec, "aismr").compile(checkpointer=MemorySaver())

    run_id = "run-aismr-001"
    initial_state = {
        "run_id": run_id,
        "project": "aismr",
        "input": "Surreal candle study",
        "videos": [
            {"subject": "candle", "header": "melting glass"},
            {"subject": "candle", "header": "levitating petals"},
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
            assert interrupt.value.get("project") == "aismr"
            gates.append(gate)
            pending = Command(resume={"approved": True, "gate": gate, "approver": "qa"})
            continue
        break

    assert gates == ["ideate", "prepublish"]
    assert result.get("awaiting_gate") in (None, "")

    personas = [entry["persona"] for entry in result.get("persona_history", [])]
    assert personas == ["iggy", "riley", "alex", "quinn"]

    modifiers = result.get("modifiers") or []
    scripts = result.get("scripts") or []
    clips = result.get("clips") or []
    publish_urls = result.get("publishUrls") or []

    assert len(modifiers) == 12
    assert len(scripts) == 12
    assert len(clips) == 12
    for script in scripts:
        assert script.get("durationSeconds") == 8
    for clip in clips:
        assert clip.get("status") == "generated"

    assert publish_urls
    assert publish_urls[0].startswith(f"https://publish.example/{run_id}/0")
    assert result.get("completed") is True
