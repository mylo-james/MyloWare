import asyncio
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport

from myloware.api.server import app
from myloware.config import settings
from myloware.storage.database import init_async_db


@pytest.mark.anyio
@pytest.mark.integration
async def test_runs_start_rate_limit_hits_after_threshold(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Ensure rate limiter returns 429 after burst on same API key."""

    monkeypatch.setattr(settings, "llama_stack_provider", "fake")
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "remotion_provider", "fake")
    monkeypatch.setattr(settings, "upload_post_provider", "fake")
    monkeypatch.setattr(
        settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 'rate_limit.db'}"
    )
    api_key = f"rate-limit-key-{uuid.uuid4()}"
    monkeypatch.setattr(settings, "api_key", api_key)
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    # Tighten rate limit for the test so we hit the ceiling quickly.
    monkeypatch.setattr(settings, "run_rate_limit", "10/minute")

    await init_async_db()

    headers = {"X-API-Key": api_key}
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
