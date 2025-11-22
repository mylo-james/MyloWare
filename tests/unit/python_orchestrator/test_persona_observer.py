from __future__ import annotations

import copy

import pytest

from apps.orchestrator import persona_nodes
from apps.orchestrator.run_state import RunState


@pytest.fixture()
def sample_snapshot() -> dict[str, object]:
    return {
        "runId": "observer-run",
        "result": {
            "videos": [
                {
                    "index": 0,
                    "subject": "moon",
                    "header": "cheeseburger",
                    "status": "pending",
                    "prompt": "Moon shot",
                },
                {
                    "index": 1,
                    "subject": "sun",
                    "header": "pickle",
                    "status": "published",
                    "prompt": "Sun shot",
                    "publishUrl": "https://publish.example/sun",
                },
            ],
            "publishUrls": ["https://publish.example/sun"],
        },
        "artifacts": [
            {"type": "publish.url", "persona": "quinn", "url": "https://publish.example/sun"},
        ],
    }


def test_observer_persona_populates_storyboards(monkeypatch: pytest.MonkeyPatch, sample_snapshot: dict[str, object]) -> None:
    monkeypatch.setattr(persona_nodes, "LANGCHAIN_AVAILABLE", False, raising=False)
    monkeypatch.setattr(persona_nodes, "_get_run_snapshot", lambda _: copy.deepcopy(sample_snapshot), raising=False)
    state: RunState = {"run_id": "observer-run", "project": "test_video_gen", "transcript": [], "persona_history": []}

    node = persona_nodes.create_persona_node("iggy", "test_video_gen")
    with pytest.raises(RuntimeError, match="LangChain persona execution disabled"):
        node(state)


def test_observer_handles_snapshot_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(persona_nodes, "LANGCHAIN_AVAILABLE", False, raising=False)

    def raise_error(run_id: str) -> dict[str, object]:  # noqa: ARG001
        raise RuntimeError("api unreachable")

    monkeypatch.setattr(persona_nodes, "_get_run_snapshot", raise_error, raising=False)
    state: RunState = {"run_id": "broken-run", "project": "test_video_gen", "transcript": [], "persona_history": []}

    node = persona_nodes.create_persona_node("quinn", "test_video_gen")
    with pytest.raises(RuntimeError, match="LangChain persona execution disabled"):
        node(state)
