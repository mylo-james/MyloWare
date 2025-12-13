import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI
from httpx import AsyncClient

from api.middleware import safety
from config import settings


@pytest.mark.asyncio
async def test_safety_middleware_blocks_on_shield_error(monkeypatch):
    # Ensure shielded path is taken
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    # Safety always fails closed (no safety_fail_open setting)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    async def boom(_content: str):
        raise RuntimeError("shield down")

    monkeypatch.setattr(safety, "check_content_safety", boom)

    app = FastAPI()
    app.middleware("http")(safety.safety_shield_middleware)

    @app.post("/echo")
    async def echo(body: str):
        return {"ok": True}

    from httpx import ASGITransport

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/echo", content="unsafe payload")

    assert resp.status_code == 400
    assert resp.json()["reason"] == "shield_error"
