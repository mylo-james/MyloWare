from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from apps.orchestrator import graph_executor


class FakeGraph:
    def __init__(self, *, result: dict[str, Any] | None = None, error: Exception | None = None) -> None:
        self._result = result or {}
        self._error = error
        self.invocations: list[tuple[dict[str, Any], dict[str, Any]]] = []

    def invoke(self, state: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
        self.invocations.append((state, config))
        if self._error:
            raise self._error
        return self._result


class FakeCheckpointer:
    def __init__(self) -> None:
        self.saved: list[tuple[str, dict[str, Any]]] = []

    def save(self, run_id: str, state: dict[str, Any]) -> None:
        self.saved.append((run_id, state))


def test_execute_production_graph_sync_with_explicit_checkpointer() -> None:
    fake_graph = FakeGraph(result={"status": "sync-ok"})
    fake_cp = FakeCheckpointer()

    result = graph_executor.execute_production_graph_sync(
        graph=fake_graph,
        run_id="run-sync",
        initial_state={"project": "test_video_gen"},
        checkpointer=fake_cp,
    )

    assert result == {"status": "sync-ok"}
    assert fake_cp.saved[-1] == ("run-sync", {"status": "sync-ok"})


def test_execute_production_graph_sync_injects_langsmith_run(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_graph = FakeGraph(result={"status": "with-langsmith"})
    fake_cp = FakeCheckpointer()

    sentinel_run = object()
    monkeypatch.setattr(graph_executor, "start_langsmith_run", lambda *args, **kwargs: sentinel_run)

    ended: list[tuple[Any, dict[str, Any]]] = []

    def fake_end(run: Any, *, outputs: dict[str, Any] | None = None, error: str | None = None) -> None:  # noqa: ARG001
        ended.append((run, outputs or {}))

    monkeypatch.setattr(graph_executor, "end_langsmith_run", fake_end)

    result = graph_executor.execute_production_graph_sync(
        graph=fake_graph,
        run_id="run-langsmith",
        initial_state={"project": "test_video_gen"},
        checkpointer=fake_cp,
    )

    assert result == {"status": "with-langsmith"}
    assert fake_graph.invocations
    invoke_state, _ = fake_graph.invocations[0]
    assert invoke_state["_langsmith_run"] is sentinel_run
    # Saved state should not contain the RunTree reference.
    saved_run_id, saved_state = fake_cp.saved[-1]
    assert saved_run_id == "run-langsmith"
    assert saved_state == {"status": "with-langsmith"}
    assert ended and ended[-1][0] is sentinel_run


def test_execute_production_graph_sync_creates_checkpointer(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_graph = FakeGraph(result={"status": "auto-cp"})

    created: list[str] = []

    class DummyCP:
        def __init__(self, dsn: str) -> None:
            created.append(dsn)
            self.saved: list[tuple[str, dict[str, Any]]] = []

        def save(self, run_id: str, state: dict[str, Any]) -> None:
            self.saved.append((run_id, state))

    monkeypatch.setattr(graph_executor, "PostgresCheckpointer", DummyCP)
    monkeypatch.setattr(graph_executor.settings, "db_url", "postgresql://orchestrator-db")

    result = graph_executor.execute_production_graph_sync(
        graph=fake_graph,
        run_id="run-sync-auto",
        initial_state={"project": "aismr"},
    )

    assert result == {"status": "auto-cp"}
    assert created == ["postgresql://orchestrator-db"]


@pytest.mark.anyio
async def test_execute_production_graph_success(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_graph = FakeGraph(result={"status": "done"})
    fake_cp = FakeCheckpointer()

    http_calls: list[dict[str, Any]] = []

    def fake_post(url: str, json: dict[str, Any], headers: dict[str, str], timeout: float) -> None:  # noqa: ARG001
        http_calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})

    fake_httpx = types.SimpleNamespace(post=fake_post)
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)

    await graph_executor.execute_production_graph(
        graph=fake_graph,
        run_id="run-success",
        initial_state={"project": "aismr"},
        checkpointer=fake_cp,
    )

    assert fake_cp.saved[-1] == ("run-success", {"status": "done"})
    assert http_calls and http_calls[0]["json"]["message"].startswith("Run run-success")


@pytest.mark.anyio
async def test_execute_production_graph_error(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    fake_graph = FakeGraph(error=RuntimeError("boom"))
    fake_cp = FakeCheckpointer()

    fake_httpx = types.SimpleNamespace(post=lambda *args, **kwargs: None)
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)

    with caplog.at_level("ERROR", logger="myloware.orchestrator.executor"):
        with pytest.raises(RuntimeError):
            await graph_executor.execute_production_graph(
                graph=fake_graph,
                run_id="run-fail",
                initial_state={"project": "test_video_gen", "metadata": {}},
                checkpointer=fake_cp,
            )

    run_id, state = fake_cp.saved[-1]
    assert run_id == "run-fail"
    assert state["metadata"]["error"] == "boom"
    assert any(getattr(record, "run_id", None) == "run-fail" for record in caplog.records)
