from __future__ import annotations

from apps.orchestrator import persona_nodes
from apps.orchestrator.persona_nodes import create_persona_node
from apps.orchestrator.run_state import RunState


def _base_state() -> RunState:
    return {
        "run_id": "aismr-run-1",
        "project": "aismr",
        "videos": [
            {"subject": "candle", "header": "levitating wax"},
            {"subject": "candle", "header": "shattering flame"},
        ],
        "transcript": [],
        "persona_history": [],
    }


def test_iggy_generates_modifiers_from_snapshot() -> None:
    node = create_persona_node("iggy", "aismr")
    new_state = node(_base_state())
    modifiers = new_state.get("modifiers")
    assert modifiers and len(modifiers) == 12


def test_riley_generates_scripts_and_clips() -> None:
    iggy_state = create_persona_node("iggy", "aismr")(_base_state())
    riley_state = create_persona_node("riley", "aismr")(iggy_state)
    scripts = riley_state.get("scripts")
    clips = riley_state.get("clips")
    assert scripts and len(scripts) == 12
    assert clips and clips[0]["status"] == "generated"


def test_alex_normalizes_clips() -> None:
    iggy_state = create_persona_node("iggy", "aismr")(_base_state())
    riley_state = create_persona_node("riley", "aismr")(iggy_state)
    alex_state = create_persona_node("alex", "aismr")(riley_state)
    renders = alex_state.get("renders")
    assert renders and renders[0]["renderUrl"].startswith("https://assets.example/variant/")


def test_quinn_publishes_urls() -> None:
    state = create_persona_node("iggy", "aismr")(_base_state())
    state = create_persona_node("riley", "aismr")(state)
    state = create_persona_node("alex", "aismr")(state)
    quinn_state = create_persona_node("quinn", "aismr")(state)
    publish_urls = quinn_state.get("publishUrls")
    assert publish_urls and publish_urls[0].startswith("https://publish.example/aismr-run-1/")
    assert quinn_state.get("completed") is True


def test_alex_mock_persona_calls_render_with_timeline(monkeypatch: "pytest.MonkeyPatch") -> None:
    # Ensure mock personas never call render_video_timeline_tool with a bare clips array.
    calls: list[tuple[str, dict[str, object]]] = []

    def fake_render(run_id: str, timeline: dict[str, object]) -> str:  # noqa: ANN001
        calls.append((run_id, timeline))
        return "Shotstack render submitted"

    # Force LangChain personas off so the mock path is used.
    monkeypatch.setattr(persona_nodes.settings, "enable_langchain_personas", False, raising=False)
    monkeypatch.setattr(persona_nodes.persona_tools, "render_video_timeline_tool", fake_render, raising=False)

    iggy_state = create_persona_node("iggy", "aismr")(_base_state())
    riley_state = create_persona_node("riley", "aismr")(iggy_state)
    _ = create_persona_node("alex", "aismr")(riley_state)

    assert calls, "Alex should invoke render_video_timeline_tool in mock runs"
    run_id, payload = calls[0]
    assert run_id == "aismr-run-1"
    assert isinstance(payload, dict)
    assert "timeline" in payload and "output" in payload
