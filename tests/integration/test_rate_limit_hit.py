import asyncio
import sys
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from api.server import app
from config import settings
from storage.database import init_async_db


@pytest.mark.anyio
@pytest.mark.integration
async def test_runs_start_rate_limit_hits_after_threshold():
    """Ensure rate limiter returns 429 after burst on same API key."""

    settings.llama_stack_provider = "fake"
    settings.sora_provider = "fake"
    settings.remotion_provider = "fake"
    settings.upload_post_provider = "fake"
    settings.database_url = "sqlite+aiosqlite:///./test_rate_limit.db"
    settings.api_key = f"rate-limit-key-{uuid.uuid4()}"
    settings.disable_background_workflows = True
    # Tighten rate limit for the test so we hit the ceiling quickly
    settings.run_rate_limit = "10/minute"

    await init_async_db()

    headers = {"X-API-Key": settings.api_key}
    payload = {"workflow": "aismr", "brief": "Rate limit test"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        responses = []
        # limiter configured to 10/min (overridden above); send 12 requests quickly
        for _ in range(12):
            resp = await client.post("/v1/runs/start", json=payload, headers=headers)
            responses.append(resp)
            await asyncio.sleep(0)  # yield

    status_codes = [r.status_code for r in responses]
    assert 429 in status_codes
    assert responses[0].status_code != 429
