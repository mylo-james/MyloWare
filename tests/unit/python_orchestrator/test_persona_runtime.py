from __future__ import annotations

import pytest

from apps.orchestrator import persona_runtime


def test_count_artifacts_of_type() -> None:
    state = {
        "artifacts": [
            {"type": "retrieval.trace"},
            {"type": "render.url"},
            {"type": "retrieval.trace"},
        ]
    }

    assert persona_runtime.count_artifacts_of_type(state, "retrieval.trace") == 2


def test_resolve_project_spec_for_state_uses_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    state: dict[str, object] = {}
    monkeypatch.setattr(
        persona_runtime,
        "load_project_spec_fallback",
        lambda project: {"specs": {"project": project}},
    )

    spec = persona_runtime.resolve_project_spec_for_state(state, "test_video_gen")

    assert spec["specs"]["project"] == "test_video_gen"
    assert state["project_spec"] == spec
