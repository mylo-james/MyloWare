import asyncio
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

from myloware.api.server import app
from myloware.config import settings
from myloware.storage.database import init_async_db


@pytest.mark.anyio
@pytest.mark.integration
async def test_runs_start_concurrent_requests(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Smoke test: concurrent start calls should stay responsive (no 5xx/locks)."""
    # Use unique API key to avoid rate limit collision with other tests
    unique_key = f"test-concurrency-{uuid.uuid4()}"

    monkeypatch.setattr(settings, "llama_stack_provider", "fake")
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "remotion_provider", "fake")
    monkeypatch.setattr(settings, "upload_post_provider", "fake")
    monkeypatch.setattr(
        settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 'runs_concurrency.db'}"
    )
    monkeypatch.setattr(settings, "api_key", unique_key)
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    # Ensure tables exist when lifespan isn't executed by ASGITransport
    await init_async_db()

    headers = {"X-API-Key": unique_key}
    payload = {"workflow": "aismr", "brief": "Concurrent brief"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        tasks = [client.post("/v1/runs/start", json=payload, headers=headers) for _ in range(5)]
        responses = await asyncio.gather(*tasks)

    assert all(r.status_code == 200 for r in responses)
    assert len({r.json()["run_id"] for r in responses}) == 5
