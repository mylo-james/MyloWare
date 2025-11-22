from __future__ import annotations

import types

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.types import Command
from langgraph.checkpoint.memory import MemorySaver

# CRITICAL: Patch checkpointer BEFORE importing server
# This prevents DB connection attempts during module import
from apps.orchestrator import langgraph_checkpoint
langgraph_checkpoint.get_graph_checkpointer = lambda: MemorySaver()

from apps.orchestrator import server


@pytest.fixture(autouse=True)
def stub_project_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeCompiledGraph:
        def invoke(self, state, config=None):  # type: ignore[no-untyped-def]
            if isinstance(state, Command):
                resume = state.resume or {}
                gate = (resume.get("gate") or "ideate").lower()
                run_id = resume.get("run_id", "run")
                if gate == "ideate":
                    return {
                        "run_id": run_id,
                        "project": resume.get("project", "test_video_gen"),
                        "__interrupt__": True,
                        "awaiting_gate": "prepublish",
                        "persona_history": ["iggy", "riley"],
                        "current_persona": "riley",
                    }
                return {
                    "run_id": run_id,
                    "project": resume.get("project", "test_video_gen"),
                    "__interrupt__": False,
                    "awaiting_gate": None,
                    "completed": True,
                    "persona_history": ["iggy", "riley", "quinn"],
                    "current_persona": "quinn",
                }
            run_id = state.get("run_id", "run")
            return {
                "run_id": run_id,
                "project": state.get("project"),
                "__interrupt__": True,
                "awaiting_gate": "ideate",
                "persona_history": ["iggy"],
                "current_persona": "iggy",
            }

    class _FakeGraph:
        def compile(self, checkpointer):  # type: ignore[no-untyped-def]
            return _FakeCompiledGraph()

    monkeypatch.setattr(server, "build_project_graph", lambda spec, project: _FakeGraph())


@pytest.mark.asyncio
async def test_health_ok() -> None:
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_run_endpoint_returns_state() -> None:
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/runs/run-123",
            json={
                "project": "test_video_gen",
                "input": "ping",
                "videos": [
                    {"subject": "mock", "header": "demo"},
                    {"subject": "mock-2", "header": "demo-2"},
                ],
            },
            headers={"x-api-key": server.settings.api_key},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["run_id"] == "run-123"
    state = body["state"]
    assert state["current_persona"] in {"iggy", "alex", "quinn"}
    assert "persona_history" in state
    assert len(state["persona_history"]) >= 1


@pytest.mark.asyncio
async def test_run_endpoint_sends_notifications(monkeypatch: pytest.MonkeyPatch) -> None:
    notifications: list[dict[str, str]] = []

    class DummyResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {"status": "ok"}

    def fake_httpx_post(url: str, *, json: dict | None = None, headers=None, timeout=None, params=None):  # noqa: ANN001, ARG003, ARG004
        if "/v1/notifications/graph/" in url:
            notifications.append(json or {})
            return DummyResponse()
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(server, "httpx", types.SimpleNamespace(post=fake_httpx_post))
    monkeypatch.setattr(server, "start_langsmith_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(server, "end_langsmith_run", lambda *args, **kwargs: None)

    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "project": "test_video_gen",
            "input": "demo",
            "videos": [
                {"subject": "moon", "header": "Scene 1"},
                {"subject": "sun", "header": "Scene 2"},
            ],
        }
        response = await client.post(
            "/runs/run-notify",
            headers={"x-api-key": server.settings.api_key},
            params={"background": "false"},
            json=payload,
        )
        assert response.status_code == 200

        resume_payload = {"project": "test_video_gen", "resume": {"approved": True, "gate": "ideate"}}
        resume_response = await client.post(
            "/runs/run-notify",
            headers={"x-api-key": server.settings.api_key},
            params={"background": "false"},
            json=resume_payload,
        )
        assert resume_response.status_code == 200

        final_response = await client.post(
            "/runs/run-notify",
            headers={"x-api-key": server.settings.api_key},
            params={"background": "false"},
            json={"project": "test_video_gen", "resume": {"approved": True, "gate": "prepublish"}},
        )
        assert final_response.status_code == 200

    assert [note.get("notification_type") for note in notifications] == [
        "awaiting_ideate",
        "awaiting_prepublish",
        "completed",
    ]


@pytest.mark.asyncio
async def test_run_endpoint_emits_langsmith_traces(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_run = types.SimpleNamespace(ended=False, outputs=None, error=None)

    def fake_start(name, inputs, tags=None, metadata=None):  # noqa: ANN001
        assert "graph" in tags
        assert inputs["run_id"] == "run-langsmith"
        return fake_run

    def fake_end(run, outputs=None, error=None):  # noqa: ANN001
        run.ended = True
        run.outputs = outputs
        run.error = error

    monkeypatch.setattr(server, "start_langsmith_run", fake_start)
    monkeypatch.setattr(server, "end_langsmith_run", fake_end)

    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "project": "test_video_gen",
            "input": "demo",
            "videos": [
                {"subject": "moon", "header": "Scene 1"},
                {"subject": "sun", "header": "Scene 2"},
            ],
        }
        response = await client.post(
            "/runs/run-langsmith",
            headers={"x-api-key": server.settings.api_key},
            params={"background": "false"},
            json=payload,
        )

    assert response.status_code == 200
    assert fake_run.ended is True
    assert fake_run.error is None
    assert "awaiting_gate" in fake_run.outputs
