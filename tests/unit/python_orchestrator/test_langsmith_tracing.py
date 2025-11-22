from __future__ import annotations

from typing import Any

import pytest

from apps.orchestrator import langsmith_tracing


class DummyRun:
    def __init__(self) -> None:
        self.ended_with: dict[str, Any] | None = None
        self.failures: int = 0

    def end(self, outputs: dict[str, Any] | None = None, error: str | None = None) -> None:
        if self.failures:
            raise RuntimeError("end failed")
        self.ended_with = {"outputs": outputs, "error": error}


class DummyRunTree:
    def __init__(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401,D401
        self.args = args
        self.kwargs = kwargs

    def end(self, outputs: dict[str, Any] | None = None, error: str | None = None) -> None:
        self.kwargs["ended"] = {"outputs": outputs, "error": error}

    def post(self) -> None:
        self.kwargs["posted"] = True

    def patch(self) -> None:
        self.kwargs["patched"] = True


def test_start_langsmith_run_returns_none_when_langsmith_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(langsmith_tracing, "LANGSMITH_AVAILABLE", False, raising=False)
    run = langsmith_tracing.start_langsmith_run("name", {"input": "x"})
    assert run is None


def test_start_langsmith_run_returns_none_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(langsmith_tracing, "LANGSMITH_AVAILABLE", True, raising=False)
    monkeypatch.setattr(langsmith_tracing.settings, "langsmith_api_key", "", raising=False)
    run = langsmith_tracing.start_langsmith_run("name", {"input": "x"})
    assert run is None


def test_start_langsmith_run_creates_run_tree(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(langsmith_tracing, "LANGSMITH_AVAILABLE", True, raising=False)
    monkeypatch.setattr(langsmith_tracing.settings, "langsmith_api_key", "key", raising=False)
    monkeypatch.setattr(langsmith_tracing.settings, "langsmith_project", "proj", raising=False)
    monkeypatch.setattr(langsmith_tracing, "RunTree", DummyRunTree, raising=False)

    run = langsmith_tracing.start_langsmith_run("graph", {"run_id": "r1"})
    assert isinstance(run, DummyRunTree)
    # Ensure project name is wired correctly
    assert run.kwargs["project_name"] == "proj"
    assert run.kwargs["name"] == "graph"


def test_end_langsmith_run_noop_when_run_is_none() -> None:
    # Should not raise when run is None
    langsmith_tracing.end_langsmith_run(None, outputs={"ok": True})


def test_end_langsmith_run_propagates_outputs(monkeypatch: pytest.MonkeyPatch) -> None:
    run = DummyRun()
    langsmith_tracing.end_langsmith_run(run, outputs={"status": "ok"})
    assert run.ended_with == {"outputs": {"status": "ok"}, "error": None}


def test_end_langsmith_run_swallows_errors(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("WARNING")
    failing = DummyRun()
    failing.failures = 1
    # Should not raise even if end() fails
    langsmith_tracing.end_langsmith_run(failing, error="boom")
    assert "Failed to finish LangSmith run" in caplog.text
