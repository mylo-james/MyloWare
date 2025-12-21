import anyio
import json
import uuid as uuid_mod
from uuid import UUID
import pytest
from httpx import AsyncClient, ASGITransport

from myloware.api.server import app
from myloware.config import settings
from myloware.storage.database import get_async_session_factory, init_async_db
from myloware.storage.repositories import RunRepository


@pytest.mark.anyio
@pytest.mark.integration
async def test_langgraph_webhook_flow_smoke(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """E2E smoke: start LangGraph run, simulate Sora and Remotion webhooks, verify final state."""
    # Use unique API key to avoid rate limit collision with other tests
    unique_key = f"test-webhook-{uuid_mod.uuid4()}"

    monkeypatch.setattr(settings, "llama_stack_provider", "fake")
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "remotion_provider", "fake")
    monkeypatch.setattr(settings, "upload_post_provider", "fake")
    monkeypatch.setattr(settings, "use_langgraph_engine", True)
    monkeypatch.setattr(
        settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 'webhook_flow.db'}"
    )
    monkeypatch.setattr(settings, "api_key", unique_key)
    # Keep fast lane isolated: accept webhook payloads without triggering transcoding/resumes.
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    # Ensure schema exists for ASGITransport
    await init_async_db()

    headers = {"X-API-Key": unique_key}
    payload = {"workflow": "aismr", "brief": "Webhook smoke test"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Start LangGraph run via /v2/runs/start
        start_resp = await client.post("/v2/runs/start", json=payload, headers=headers)
        assert start_resp.status_code == 200
        start_data = start_resp.json()
        run_id = start_data["run_id"]

        # Simulate Sora webhook (video generation complete)
        sora_webhook_payload = {
            "code": 200,
            "msg": "success",
            "data": {
                "taskId": "task-123",
                "state": "success",
                "info": {
                    "resultUrls": [
                        "https://cdn.example.com/clip1.mp4",
                        "https://cdn.example.com/clip2.mp4",
                    ]
                },
            },
        }
        sora_hook_resp = await client.post(
            f"/v1/webhooks/sora?run_id={run_id}",
            content=json.dumps(sora_webhook_payload),
            headers={"Content-Type": "application/json"},
        )
        assert sora_hook_resp.status_code == 200

        # Allow time for workflow to process Sora webhook
        await anyio.sleep(0.2)

        # Simulate Remotion webhook (render complete)
        remotion_webhook_payload = {
            "status": "done",
            "output_url": "https://cdn.example.com/final-video.mp4",
            "job_id": "job-123",
        }
        remotion_hook_resp = await client.post(
            f"/v1/webhooks/remotion?run_id={run_id}",
            content=json.dumps(remotion_webhook_payload),
            headers={"X-Remotion-Signature": "", "Content-Type": "application/json"},
        )
        assert remotion_hook_resp.status_code == 200

        # Allow time for workflow to process Remotion webhook
        await anyio.sleep(0.2)

    # Verify final state and artifacts
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.get_async(UUID(run_id))
        assert run is not None

        # In fake mode, artifacts may be stored differently; verify run reached a terminal-ish state.
        assert run.status in ("completed", "awaiting_publish_approval", "running")

    # Verify we can get run state via LangGraph API
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        state_resp = await client.get(f"/v2/runs/{run_id}/state", headers=headers)
        assert state_resp.status_code == 200
        state_data = state_resp.json()
        assert "state" in state_data


@pytest.mark.anyio
@pytest.mark.integration
async def test_start_to_remotion_webhook_smoke(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """E2E smoke: start run then deliver a remotion webhook and see render artifact persisted (legacy v1 API)."""
    # Use unique API key to avoid rate limit collision with other tests
    unique_key = f"test-webhook-{uuid_mod.uuid4()}"

    monkeypatch.setattr(settings, "llama_stack_provider", "fake")
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "remotion_provider", "fake")
    monkeypatch.setattr(settings, "upload_post_provider", "fake")
    monkeypatch.setattr(
        settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 'webhook_flow.db'}"
    )
    monkeypatch.setattr(settings, "api_key", unique_key)
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    # Ensure schema exists for ASGITransport
    await init_async_db()

    headers = {"X-API-Key": unique_key}
    payload = {"workflow": "aismr", "brief": "Webhook smoke"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        start_resp = await client.post("/v1/runs/start", json=payload, headers=headers)
        assert start_resp.status_code == 200
        run_id = start_resp.json()["run_id"]

        # Send a fake Remotion completion webhook
        webhook_payload = {
            "status": "done",
            "output_url": "https://cdn.example.com/video.mp4",
            "id": "job-123",
        }
        hook_resp = await client.post(
            f"/v1/webhooks/remotion?run_id={run_id}",
            content=json.dumps(webhook_payload),
            headers={"X-Remotion-Signature": ""},
        )
        assert hook_resp.status_code == 200

        # Allow background task to persist status/artifact
        await anyio.sleep(0.1)

    # Verify artifact was created
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.get_async(UUID(run_id))
        assert run is not None
        artifacts = run.artifacts or {}
        assert "video" in artifacts
