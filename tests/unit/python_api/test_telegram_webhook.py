from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import httpx
import pytest
from starlette.requests import Request

from apps.api.config import Settings
from apps.api.integrations import telegram as telegram_module


class FakeResponse:
    def __init__(self, *, json_data: dict[str, Any] | None = None, status_code: int = 200, url: str = "http://test.local") -> None:
        self._json = json_data or {}
        request = httpx.Request("POST", url)
        self._response = httpx.Response(status_code=status_code, request=request)

    def raise_for_status(self) -> None:
        self._response.raise_for_status()

    def json(self) -> dict[str, Any]:
        return dict(self._json)


class FakeAsyncClient:
    def __init__(self, responses: list[object]) -> None:
        self._responses = responses
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self) -> FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, *, json: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: int | None = None) -> Any:
        self.calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        if not self._responses:
            raise AssertionError("No scripted responses left for FakeAsyncClient")
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeAsyncClientFactory:
    def __init__(self, scripts: Sequence[list[object]]) -> None:
        self._scripts = [list(script) for script in scripts]
        self.instances: list[FakeAsyncClient] = []

    def __call__(self, *args, **kwargs) -> FakeAsyncClient:
        if not self._scripts:
            raise AssertionError("No FakeAsyncClient scripts remaining")
        client = FakeAsyncClient(self._scripts.pop(0))
        self.instances.append(client)
        return client


def _json_request(payload: dict[str, Any]) -> Request:
    body = json.dumps(payload).encode("utf-8")

    async def receive() -> dict[str, Any]:
        nonlocal body
        chunk, body = body, b""
        return {"type": "http.request", "body": chunk, "more_body": False}

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/v1/telegram/webhook",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 12345),
    }
    return Request(scope, receive)


def _override_settings(monkeypatch: pytest.MonkeyPatch, *, token: str | None = "bot-token") -> Settings:
    fake_settings = Settings(
        api_key="tg-api-key",
        orchestrator_base_url="http://orchestrator.local",
        telegram_bot_token=token,
    )
    monkeypatch.setattr(telegram_module, "get_settings", lambda: fake_settings)
    return fake_settings


@pytest.mark.asyncio
async def test_telegram_webhook_forwards_message_and_replies(monkeypatch: pytest.MonkeyPatch) -> None:
    telegram_module.reset_idempotency_cache()
    _override_settings(monkeypatch, token="bot-token")
    factory = FakeAsyncClientFactory(
        [
            [
                FakeResponse(json_data={"response": "Brendan says hi"}, url="http://orchestrator.local/v1/chat/brendan"),
                FakeResponse(json_data={"ok": True}, url="https://api.telegram.org"),
            ]
        ]
    )
    monkeypatch.setattr(telegram_module.httpx, "AsyncClient", factory)

    request = _json_request({"message": {"text": "hello Brendan", "chat": {"id": 42}}})
    payload = await telegram_module.telegram_webhook(request)

    assert payload["ok"] is True
    assert payload["brendan_response"] == "Brendan says hi"

    assert factory.instances, "expected AsyncClient to be used"
    orchestrator_calls = factory.instances[0].calls
    assert orchestrator_calls[0]["url"] == "http://orchestrator.local/v1/chat/brendan"
    assert orchestrator_calls[0]["json"]["message"] == "hello Brendan"
    assert orchestrator_calls[0]["headers"]["x-api-key"] == "tg-api-key"
    assert orchestrator_calls[1]["url"].startswith("https://api.telegram.org/botbot-token/sendMessage")


@pytest.mark.asyncio
async def test_telegram_webhook_returns_ok_when_missing_text(monkeypatch: pytest.MonkeyPatch) -> None:
    telegram_module.reset_idempotency_cache()
    _override_settings(monkeypatch, token=None)
    called = False

    def _fail_client(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("httpx.AsyncClient should not be instantiated")

    monkeypatch.setattr(telegram_module.httpx, "AsyncClient", _fail_client)

    request = _json_request({"message": {"text": "", "chat": {"id": 101}}})
    payload = await telegram_module.telegram_webhook(request)

    assert payload == {"ok": True}
    assert called is False


@pytest.mark.asyncio
async def test_telegram_webhook_handles_http_error_and_notifies_user(monkeypatch: pytest.MonkeyPatch) -> None:
    telegram_module.reset_idempotency_cache()
    _override_settings(monkeypatch, token="tg-token")
    failure = httpx.HTTPError("orchestrator unavailable")
    factory = FakeAsyncClientFactory(
        [
            [failure],
            [FakeResponse(json_data={"ok": True}, url="https://api.telegram.org/bottg-token/sendMessage")],
        ]
    )
    monkeypatch.setattr(telegram_module.httpx, "AsyncClient", factory)

    request = _json_request({"message": {"text": "hello", "chat": {"id": 84}}})
    payload = await telegram_module.telegram_webhook(request)

    assert payload["ok"] is True
    assert "orchestrator unavailable" in payload["error"]

    assert len(factory.instances) == 2
    # Second AsyncClient call (error notification) should hit Telegram API
    error_calls = factory.instances[1].calls
    assert error_calls[0]["json"]["chat_id"] == "84"
    assert "Sorry" in error_calls[0]["json"]["text"]


@pytest.mark.asyncio
async def test_telegram_webhook_deduplicates_recent_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    telegram_module.reset_idempotency_cache()
    _override_settings(monkeypatch, token="bot-token")
    factory = FakeAsyncClientFactory(
        [
            [
                FakeResponse(json_data={"response": "Done"}, url="http://orchestrator.local/v1/chat/brendan"),
                FakeResponse(json_data={"ok": True}, url="https://api.telegram.org"),
            ]
        ]
    )
    monkeypatch.setattr(telegram_module.httpx, "AsyncClient", factory)

    payload = {"update_id": 12345, "message": {"text": "hello", "chat": {"id": 77}}}
    first = await telegram_module.telegram_webhook(_json_request(payload))
    assert first["ok"] is True

    duplicate = await telegram_module.telegram_webhook(_json_request(payload))
    assert duplicate == {"ok": True, "duplicate": True}

    assert len(factory.instances) == 1
