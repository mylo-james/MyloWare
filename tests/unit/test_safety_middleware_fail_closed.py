import asyncio

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from myloware.api.middleware import safety
from myloware.config import settings


@pytest.mark.asyncio
async def test_safety_middleware_returns_400_on_shield_error(monkeypatch):
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    async def boom(_content: str):
        raise RuntimeError("shield down")

    monkeypatch.setattr(safety, "check_content_safety", boom)

    app = FastAPI()
    app.middleware("http")(safety.safety_shield_middleware)

    @app.post("/echo")
    async def echo(body: str):
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/echo", content="unsafe payload")

    assert resp.status_code == 400
    assert resp.json()["error"] == "content_blocked"


@pytest.mark.asyncio
async def test_safety_middleware_timeout_blocks(monkeypatch):
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    async def slow_check(_content: str):
        await asyncio.sleep(10)

    monkeypatch.setattr(safety, "check_content_safety", slow_check)

    app = FastAPI()
    app.middleware("http")(safety.safety_shield_middleware)

    @app.post("/echo")
    async def echo(body: str):
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/echo", content="content")

    assert resp.status_code == 400
    assert resp.json()["error"] == "content_blocked"
    assert resp.json()["reason"] == "timeout_blocked"
