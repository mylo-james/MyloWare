"""Unit tests for Telegram notification service (no network)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from myloware.notifications.telegram import NotificationResult, TelegramNotifier


@pytest.mark.anyio
async def test_send_message_requires_token(monkeypatch) -> None:
    notifier = TelegramNotifier(bot_token="")
    out = await notifier.send_message(chat_id="1", text="x")
    assert out.success is False
    assert out.error == "No bot token"


@pytest.mark.anyio
async def test_send_message_success_and_failure_with_injected_client(monkeypatch) -> None:
    notifier = TelegramNotifier(bot_token="token")

    sent: list[dict[str, object]] = []

    class FakeClient:
        async def post(self, url: str, *, json):  # type: ignore[no-untyped-def]
            sent.append({"url": url, "json": json})
            return SimpleNamespace(json=lambda: {"ok": True, "result": {"message_id": 123}})

    ok = await notifier.send_message("1", "hello", reply_markup={"k": "v"}, client=FakeClient())
    assert ok == NotificationResult(success=True, message_id=123, error=None)
    assert sent and sent[0]["json"]["reply_markup"] == {"k": "v"}  # type: ignore[index]

    class FakeClientBad:
        async def post(self, url: str, *, json):  # type: ignore[no-untyped-def]
            return SimpleNamespace(json=lambda: {"ok": False, "description": "bad"})

    bad = await notifier.send_message("1", "hello", client=FakeClientBad())
    assert bad.success is False
    assert bad.error == "bad"


@pytest.mark.anyio
async def test_send_message_without_client_uses_httpx_async_client(monkeypatch) -> None:
    notifier = TelegramNotifier(bot_token="token")

    captured: list[dict[str, object]] = []

    class FakeResponse:
        def json(self):  # type: ignore[no-untyped-def]
            return {"ok": True, "result": {"message_id": 7}}

    class FakeHttpxClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return None

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def post(self, url: str, *, json):  # type: ignore[no-untyped-def]
            captured.append({"url": url, "json": json})
            return FakeResponse()

    monkeypatch.setattr("myloware.notifications.telegram.httpx.AsyncClient", FakeHttpxClient)
    out = await notifier.send_message(chat_id="1", text="hi")
    assert out.success is True
    assert out.message_id == 7
    assert captured and "/sendMessage" in captured[0]["url"]  # type: ignore[index]


@pytest.mark.anyio
async def test_templates_call_send_message_with_expected_text(monkeypatch) -> None:
    notifier = TelegramNotifier(bot_token="token", tone="social")
    notifier.send_message = AsyncMock(return_value=NotificationResult(success=True))  # type: ignore[method-assign]

    await notifier.send_run_started(chat_id="1", run_id="rid", project="p")
    assert "Run Started" in notifier.send_message.call_args.args[1]

    await notifier.send_run_completed(chat_id="1", run_id="rid", published_url="http://x")
    assert "Published" in notifier.send_message.call_args.args[1]

    await notifier.send_run_failed(chat_id="1", run_id="rid", error="e" * 400, step="ideator")
    assert "Run Failed" in notifier.send_message.call_args.args[1]
    assert "..." in notifier.send_message.call_args.args[1]

    await notifier.send_status_update(
        chat_id="1", run_id="rid", status="s", current_step="producer"
    )
    assert "Status Update" in notifier.send_message.call_args.args[1]


@pytest.mark.anyio
async def test_templates_ops_tone_uses_non_emoji_text(monkeypatch) -> None:
    notifier = TelegramNotifier(bot_token="token", tone="ops")
    notifier.send_message = AsyncMock(return_value=NotificationResult(success=True))  # type: ignore[method-assign]

    await notifier.send_run_started(chat_id="1", run_id="rid", project="p")
    assert "🚀" not in notifier.send_message.call_args.args[1]

    await notifier.send_run_completed(chat_id="1", run_id="rid", published_url="http://x")
    assert "✅" not in notifier.send_message.call_args.args[1]

    await notifier.send_run_failed(chat_id="1", run_id="rid", error="e", step=None)
    assert "❌" not in notifier.send_message.call_args.args[1]

    await notifier.send_status_update(
        chat_id="1", run_id="rid", status="s", current_step="producer"
    )
    assert "💡" not in notifier.send_message.call_args.args[1]


@pytest.mark.anyio
async def test_send_hitl_request_builds_reply_markup_and_truncates_preview(monkeypatch) -> None:
    notifier = TelegramNotifier(bot_token="token", tone="ops")
    notifier.send_message = AsyncMock(return_value=NotificationResult(success=True))  # type: ignore[method-assign]

    await notifier.send_hitl_request(
        chat_id="1",
        run_id="rid",
        gate="ideation",
        content_preview="x" * 800,
    )

    _chat_id, text = notifier.send_message.call_args.args[:2]
    assert _chat_id == "1"
    assert "Ideation Review" in text
    assert "..." in text
    reply_markup = notifier.send_message.call_args.kwargs["reply_markup"]
    assert reply_markup["inline_keyboard"][0][0]["text"] == "Approve"
    assert reply_markup["inline_keyboard"][0][0]["callback_data"].startswith("approve:rid:")
