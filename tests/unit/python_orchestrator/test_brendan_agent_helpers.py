from __future__ import annotations

from types import SimpleNamespace

import pytest

from apps.orchestrator import brendan_agent


class DummyResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:  # pragma: no cover - no error path in tests
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class FakeClassification:
    def __init__(self) -> None:
        self.project = "test_video_gen"
        self.skip_steps = ["alex"]
        self.optional_personas = ["zara"]
        self.custom_requirements = ["hdr"]
        self.complexity = "medium"

    def model_dump(self) -> dict[str, object]:
        return {
            "project": self.project,
            "skip_steps": self.skip_steps,
            "optional_personas": self.optional_personas,
            "custom_requirements": self.custom_requirements,
            "complexity": self.complexity,
        }


def test_derive_pipeline_handles_skip_and_optional_personas() -> None:
    spec = {"workflow": ["brendan", "iggy", "alex", "quinn"]}
    pipeline = brendan_agent._derive_pipeline(
        "test_video_gen",
        spec,
        skip_steps=["alex"],
        optional_personas=["guest"],
    )
    assert pipeline == ["iggy", "guest", "quinn"]


def test_extract_hitl_points_filters_empty_values() -> None:
    spec = {"hitlPoints": ["ideate", "", None, "prepublish"]}
    assert brendan_agent._extract_hitl_points(spec) == ["ideate", "prepublish"]


def test_start_run_from_brendan_appends_run_and_sets_pending_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    state: brendan_agent.ConversationState = {"user_id": "user-123"}

    classification = FakeClassification()
    monkeypatch.setattr(brendan_agent, "classify_request", lambda msg: classification)
    monkeypatch.setattr(
        brendan_agent,
        "load_project_spec",
        lambda project: {"workflow": ["brendan", "iggy", "alex", "quinn"], "hitlPoints": ["ideate", "prepublish"]},
    )
    monkeypatch.setattr(
        brendan_agent,
        "build_graph_spec",
        lambda **kwargs: {"pipeline": kwargs["pipeline"], "hitl_gates": kwargs["hitl_gates"]},
    )

    captured: dict[str, object] = {}

    def fake_post(url: str, json: dict[str, object], headers: dict[str, str], timeout: float) -> DummyResponse:
        captured.update({"url": url, "payload": json, "headers": headers, "timeout": timeout})
        return DummyResponse({"runId": "run-456", "status": "running"})

    monkeypatch.setattr(brendan_agent.httpx, "post", fake_post)

    fake_settings = SimpleNamespace(api_base_url="https://api.example.com/", api_key="secret", db_url="postgresql+psycopg://u:p@h/db")
    monkeypatch.setattr(brendan_agent, "settings", fake_settings)

    result = brendan_agent.start_run_from_brendan(state=state, user_request="Create something great")

    assert captured["url"] == "https://api.example.com/v1/runs/start"
    options = captured["payload"]["options"]  # type: ignore[index]
    assert options["requested_pipeline"] == ["iggy", "zara", "quinn"]
    assert options["requested_hitl_gates"] == ["ideate", "prepublish"]
    assert options["optional_personas"] == ["zara"]
    assert options["custom_requirements"] == ["hdr"]
    assert state["run_ids"] == ["run-456"]
    assert state["pending_gate"] == {"run_id": "run-456", "gate": "ideate"}
    assert result["graph_spec"]["pipeline"] == ["iggy", "zara", "quinn"]
