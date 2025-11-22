from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient as StarletteTestClient

from apps.api.config import settings as api_settings
from apps.api.main import app as api_app
from apps.api.deps import get_database, get_orchestrator_client
from apps.api.orchestrator_client import OrchestratorClient
from apps.orchestrator import server as orchestrator_server


class FakeDB:
    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.approvals: list[dict] = []

    def get_run(self, run_id: str) -> dict | None:  # type: ignore[override]
        return self.runs.get(run_id)

    def record_hitl_approval(self, *, run_id: str, gate: str, approver_ip: str | None = None, approver: str | None = None, metadata: dict | None = None) -> None:  # type: ignore[override]
        self.approvals.append({"run_id": run_id, "gate": gate, "ip": approver_ip, "metadata": metadata or {}})

    def update_run(self, *, run_id: str, status: str, result: dict | None = None) -> None:  # type: ignore[override]
        record = self.runs.setdefault(run_id, {"run_id": run_id})
        record["status"] = status
        if result is not None:
            record["result"] = result

    def create_run(self, **kwargs):  # type: ignore[override]
        self.runs[kwargs["run_id"]] = dict(kwargs)


class FakeCheckpointer:
    def __init__(self) -> None:
        self.saved: dict[str, dict] = {}

    def load(self, key: str) -> dict | None:
        return self.saved.get(key)

    def save(self, key: str, state: dict) -> None:
        self.saved[key] = state


class FakeGraph:
    def __init__(self) -> None:
        self.invocations: list[dict] = []

    def invoke(self, state, config):  # type: ignore[override]
        payload = dict(state)
        payload.update({"stage": "running", "completed": False, "awaiting_gate": None})
        self.invocations.append(payload)
        return payload


class FakeGraphBuilder:
    def __init__(self, graph: FakeGraph) -> None:
        self.graph = graph

    def compile(self, checkpointer):  # type: ignore[override]
        return self.graph


class FakeBrendanGraph:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def invoke(self, state: dict) -> dict:
        self.messages.append(state["current_message"])
        updated = dict(state)
        message = state["current_message"].lower()
        if "tell me about aismr" in message:
            updated["response"] = "AISMR is a multi-persona pipeline."
            updated["citations"] = [{"path": "docs/prd.md", "reason": "project-summary"}]
            return updated
        if "workflow" in message:
            updated["response"] = "Proposing AISMR workflow."
            updated["run_ids"] = ["run-workflow"]
            return updated
        updated["response"] = "Acknowledged."
        return updated


pytestmark = pytest.mark.anyio("asyncio")


async def test_brendan_chat_workflow_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_db = FakeDB()
    fake_cp = FakeCheckpointer()
    fake_graph = FakeGraph()
    fake_brendan = FakeBrendanGraph()
    transport = ASGITransport(app=orchestrator_server.app)
    orchestrator_client = OrchestratorClient(base_url="http://orchestrator.test", api_key=orchestrator_server.settings.api_key)
    orch_http = StarletteTestClient(orchestrator_server.app)
    orchestrator_client._client = orch_http

    monkeypatch.setattr(orchestrator_server, "_get_checkpointer", lambda: fake_cp)
    monkeypatch.setattr(orchestrator_server, "build_project_graph", lambda spec, project: FakeGraphBuilder(fake_graph))
    monkeypatch.setattr(orchestrator_server, "load_project_spec", lambda project: {"project": project})
    monkeypatch.setattr(orchestrator_server, "_ensure_brendan_graph", lambda: fake_brendan)
    orchestrator_server._brendan_graph = fake_brendan  # ensure cache uses fake

    api_app.dependency_overrides[get_database] = lambda: fake_db
    api_app.dependency_overrides[get_orchestrator_client] = lambda: orchestrator_client

    api_transport = ASGITransport(app=api_app)
    async with AsyncClient(transport=api_transport, base_url="http://api.test") as client:
        info_response = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-1", "message": "Tell me about AISMR"},
            headers={"x-api-key": api_settings.api_key},
        )
        assert info_response.status_code == 200
        info_body = info_response.json()
        assert info_body["citations"]
        assert info_body["citations"][0]["path"].endswith("docs/prd.md")

        workflow_response = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-1", "message": "Start the AISMR workflow"},
            headers={"x-api-key": api_settings.api_key},
        )
        assert workflow_response.status_code == 200
        run_ids = workflow_response.json()["run_ids"]
        assert run_ids == ["run-workflow"]

    # Graph invocation path is exercised via the orchestrator client stubs; the
    # absence of workflow gate ensures no additional approvals are required.
    api_app.dependency_overrides.pop(get_database, None)
    api_app.dependency_overrides.pop(get_orchestrator_client, None)
    orchestrator_server._brendan_graph = None
    orch_http.close()
