from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.types import Command

from apps.orchestrator import server as orchestrator_server


class FakeCheckpointer:
    def __init__(self) -> None:
        self.saved: dict[str, dict] = {}

    def load(self, run_id: str) -> dict | None:
        return self.saved.get(run_id)

    def save(self, run_id: str, state: dict) -> None:
        self.saved[run_id] = state


class FakeGraph:
    def __init__(self) -> None:
        self.invocations: list[dict] = []
        self.checkpointer: FakeCheckpointer | None = None

    def invoke(self, incoming, config):  # type: ignore[override]
        if isinstance(incoming, Command):
            state = {"resumed": True}
        else:
            state = dict(incoming)
        state.update({"stage": "complete", "completed": True, "awaiting_gate": None})
        self.invocations.append(state)
        if self.checkpointer:
            run_id = state.get("run_id") or config.get("configurable", {}).get("thread_id")
            if run_id:
                self.checkpointer.save(run_id, state)
        return state


class FakeGraphBuilder:
    def __init__(self, graph: FakeGraph) -> None:
        self._graph = graph

    def compile(self, checkpointer):  # type: ignore[override]
        self._graph.checkpointer = checkpointer
        return self._graph


@pytest.fixture()
def orchestrator_testbed(monkeypatch: pytest.MonkeyPatch):
    fake_cp = FakeCheckpointer()
    fake_graph = FakeGraph()
    notifications: list[dict] = []

    monkeypatch.setattr(orchestrator_server, "get_graph_checkpointer", lambda: fake_cp)
    monkeypatch.setattr(orchestrator_server, "_project_graphs", {}, raising=False)
    monkeypatch.setattr(orchestrator_server, "build_project_graph", lambda spec, project: FakeGraphBuilder(fake_graph))
    monkeypatch.setattr(orchestrator_server, "load_project_spec", lambda project: {"project": project})

    def fake_http_post(url: str, json: dict, headers: dict, timeout: float):
        notifications.append({"url": url, "json": json, "headers": headers})

        class DummyResponse:
            def raise_for_status(self) -> None:
                return None

        return DummyResponse()

    monkeypatch.setattr(orchestrator_server.httpx, "post", fake_http_post)
    return fake_cp, fake_graph, notifications


@pytest.mark.anyio
async def test_orchestrator_health_endpoint() -> None:
    transport = ASGITransport(app=orchestrator_server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["request_id"]


@pytest.mark.anyio
async def test_run_endpoint_executes_graph_and_sends_notification(orchestrator_testbed) -> None:
    fake_cp, fake_graph, notifications = orchestrator_testbed
    transport = ASGITransport(app=orchestrator_server.app)
    async with AsyncClient(transport=transport, base_url="http://orchestrator.test") as client:
        response = await client.post(
            "/runs/run-integration",
            json={
                "project": "aismr",
                "input": "Hello",
                "videos": [{"subject": "moon", "header": "shine"}],
                "metadata": {"options": {"gate": "workflow"}},
            },
            headers={"x-api-key": orchestrator_server.settings.api_key},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["run_id"] == "run-integration"
    assert body["state"]["project"] == "aismr"
    assert fake_cp.saved["run-integration"]["project"] == "aismr"
    assert fake_graph.invocations, "graph should be invoked"
    assert notifications
    notif = notifications[0]
    assert notif["url"].endswith("/v1/notifications/graph/run-integration")
    assert notif["json"]["notification_type"] == "completed"
