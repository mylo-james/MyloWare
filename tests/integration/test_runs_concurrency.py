import asyncio
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

from api.server import app
from config import settings
from storage.database import init_async_db


@pytest.mark.anyio
@pytest.mark.integration
@pytest.mark.parity
async def test_runs_start_concurrent_requests():
    """Smoke test: concurrent start calls should stay responsive (no 5xx/locks)."""
    # Use unique API key to avoid rate limit collision with other tests
    unique_key = f"test-concurrency-{uuid.uuid4()}"

    settings.llama_stack_provider = "fake"
    settings.sora_provider = "fake"
    settings.remotion_provider = "fake"
    settings.upload_post_provider = "fake"
    settings.database_url = "sqlite+aiosqlite:///./test_runs_concurrency.db"
    settings.api_key = unique_key
    settings.disable_background_workflows = True

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
