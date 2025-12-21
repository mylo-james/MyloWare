import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI
from httpx import AsyncClient

from myloware.api.middleware import safety
from myloware.config import settings


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


@pytest.mark.asyncio
async def test_check_content_safety_blocks_on_unsafe(monkeypatch):
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    async def fake_check(_client, _content, shield_id=None):  # type: ignore[no-untyped-def]
        return type("Resp", (), {"safe": False, "reason": "bad", "category": None})()

    monkeypatch.setattr(safety, "get_async_client", lambda: object())
    monkeypatch.setattr(safety.shield_utils, "check_content_safety", fake_check)

    verdict = await safety.check_content_safety("some content")
    assert verdict.safe is False
    assert verdict.reason == "bad"


@pytest.mark.asyncio
async def test_check_content_safety_system_error_falls_back(monkeypatch):
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "llama_stack_provider", "fake")

    async def fake_check(_client, _content, shield_id=None):  # type: ignore[no-untyped-def]
        return type("Resp", (), {"safe": False, "reason": "down", "category": "system_error"})()

    monkeypatch.setattr(safety, "get_async_client", lambda: object())
    monkeypatch.setattr(safety.shield_utils, "check_content_safety", fake_check)

    verdict = await safety.check_content_safety("kill")
    assert verdict.safe is False
    assert verdict.reason.startswith("matched_keyword:")


@pytest.mark.asyncio
async def test_check_content_safety_system_error_real(monkeypatch):
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    async def fake_check(_client, _content, shield_id=None):  # type: ignore[no-untyped-def]
        return type("Resp", (), {"safe": False, "reason": "down", "category": "system_error"})()

    monkeypatch.setattr(safety, "get_async_client", lambda: object())
    monkeypatch.setattr(safety.shield_utils, "check_content_safety", fake_check)

    verdict = await safety.check_content_safety("safe")
    assert verdict.safe is False
    assert verdict.reason == "down"


@pytest.mark.asyncio
async def test_check_content_safety_exception_real(monkeypatch):
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    async def boom(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr(safety, "get_async_client", lambda: object())
    monkeypatch.setattr(safety.shield_utils, "check_content_safety", boom)

    verdict = await safety.check_content_safety("safe")
    assert verdict.safe is False
    assert verdict.reason == "shield_error"


@pytest.mark.asyncio
async def test_safety_middleware_extracts_brief_for_run_start(monkeypatch):
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    seen = {}

    async def fake_check(content: str):
        seen["content"] = content
        return safety.SafetyVerdict(safe=True)

    monkeypatch.setattr(safety, "check_content_safety", fake_check)

    app = FastAPI()
    app.middleware("http")(safety.safety_shield_middleware)

    @app.post("/v1/runs/start")
    async def start_run():  # type: ignore[no-untyped-def]
        return {"ok": True}

    from httpx import ASGITransport

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/v1/runs/start",
            json={"workflow": "aismr", "brief": "hello world"},
        )

    assert resp.status_code == 200
    assert seen["content"] == "hello world"
