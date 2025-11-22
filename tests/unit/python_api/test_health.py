from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from types import SimpleNamespace

from apps.api.config import settings
from apps.api.main import app


@pytest.mark.asyncio
async def test_health_returns_request_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "request_id" in body


@pytest.mark.asyncio
async def test_version_requires_api_key() -> None:
    original_key = settings.api_key
    settings.api_key = "secret"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unauthorized = await client.get("/version")
        assert unauthorized.status_code == 401
        authorized = await client.get("/version", headers={"x-api-key": "secret"})
    assert authorized.status_code == 200
    assert authorized.json()["environment"] == "local"
    settings.api_key = original_key

