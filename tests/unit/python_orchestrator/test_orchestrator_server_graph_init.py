from __future__ import annotations

from typing import Any

import pytest
from apps.orchestrator import server


class _DummyGraph:
    def __init__(self) -> None:
        self.created_with: Any | None = None


def test_ensure_brendan_graph_compiles_once(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, int] = {"checkpointer": 0, "compiled": 0}

    def fake_get_checkpointer() -> object:
        calls["checkpointer"] += 1
        return object()

    def fake_compile_supervisor_graph(checkpointer: object) -> _DummyGraph:
        calls["compiled"] += 1
        graph = _DummyGraph()
        graph.created_with = checkpointer
        return graph

    # Reset cached state
    server._get_checkpointer.cache_clear()
    server._brendan_graph = None  # type: ignore[attr-defined]

    monkeypatch.setattr(server, "_get_checkpointer", fake_get_checkpointer)
    monkeypatch.setattr(server, "compile_supervisor_graph", fake_compile_supervisor_graph)

    first = server._ensure_brendan_graph()
    second = server._ensure_brendan_graph()

    # The same compiled graph instance should be reused, and compilation/checkpointer
    # should only be invoked once.
    assert isinstance(first, _DummyGraph)
    assert first is second
    assert calls["checkpointer"] == 1
    assert calls["compiled"] == 1


@pytest.mark.asyncio()
async def test_chat_endpoint_runs_in_threadpool(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, bool] = {"threadpool": False, "handled": False}
    request = server.ChatRequest(user_id="demo", message="hello")

    async def fake_run_in_threadpool(func, *args, **kwargs):
        calls["threadpool"] = True
        return func(*args, **kwargs)

    def fake_handle_chat(req: server.ChatRequest) -> server.ChatResponse:
        calls["handled"] = True
        return server.ChatResponse(response="ok", run_ids=["r-1"], citations=[])

    monkeypatch.setattr(server, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(server, "_handle_chat", fake_handle_chat)

    response = await server.chat_with_brendan(request)

    assert calls["threadpool"] is True
    assert calls["handled"] is True
    assert response.response == "ok"
    assert response.run_ids == ["r-1"]
