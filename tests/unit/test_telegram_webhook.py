"""Tests for Telegram webhook integration."""

from __future__ import annotations

from fastapi.testclient import TestClient
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from myloware.api.server import app
from myloware.config import settings


def _fake_update(text: str = "hi", update_id: int = 1, chat_id: str = "123"):
    return {
        "update_id": update_id,
        "message": {
            "message_id": 10,
            "text": text,
            "chat": {"id": chat_id, "username": "tester"},
        },
    }


def test_webhook_processes_message(monkeypatch):
    settings.telegram_bot_token = "token"
    settings.telegram_webhook_secret = "secret"
    settings.telegram_allow_all_chats = True  # Required when no allowlist set
    monkeypatch.setattr(
        "myloware.api.routes.telegram.send_telegram_message", AsyncMock(return_value=True)
    )

    fake_agent = MagicMock()
    fake_agent.create_turn.return_value = SimpleNamespace(
        completion_message=SimpleNamespace(content="ok")
    )
    monkeypatch.setattr(
        "myloware.api.routes.telegram.create_supervisor_agent", lambda client: fake_agent
    )

    client = TestClient(app)
    resp = client.post(
        "/v1/telegram/webhook",
        json=_fake_update(text="run video"),
        headers={"X-Telegram-Bot-Api-Secret-Token": "secret"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_webhook_rejects_invalid_secret():
    settings.telegram_webhook_secret = "secret"
    client = TestClient(app)
    resp = client.post(
        "/v1/telegram/webhook",
        json=_fake_update(),
        headers={"X-Telegram-Bot-Api-Secret-Token": "bad"},
    )
    assert resp.status_code == 401


def test_webhook_rejects_unconfigured_allowlist():
    """Test that empty allowlist + no explicit opt-in rejects requests."""
    settings.telegram_bot_token = "token"
    settings.telegram_webhook_secret = "secret"
    settings.telegram_allowed_chat_ids = []
    settings.telegram_allow_all_chats = False  # No explicit opt-in

    client = TestClient(app)
    resp = client.post(
        "/v1/telegram/webhook",
        json=_fake_update(),
        headers={"X-Telegram-Bot-Api-Secret-Token": "secret"},
    )

    assert resp.status_code == 403
    assert "No allowed chat IDs configured" in resp.json()["detail"]


def test_webhook_deduplicates(monkeypatch):
    settings.telegram_bot_token = "token"
    settings.telegram_webhook_secret = "secret"
    settings.telegram_allow_all_chats = True  # Required when no allowlist set
    monkeypatch.setattr(
        "myloware.api.routes.telegram.send_telegram_message", AsyncMock(return_value=True)
    )
    fake_agent = MagicMock()
    fake_agent.create_turn.return_value = SimpleNamespace(
        completion_message=SimpleNamespace(content="ok")
    )
    monkeypatch.setattr(
        "myloware.api.routes.telegram.create_supervisor_agent", lambda client: fake_agent
    )

    client = TestClient(app)
    update = _fake_update(update_id=42)
    resp1 = client.post(
        "/v1/telegram/webhook",
        json=update,
        headers={"X-Telegram-Bot-Api-Secret-Token": "secret"},
    )
    resp2 = client.post(
        "/v1/telegram/webhook",
        json=update,
        headers={"X-Telegram-Bot-Api-Secret-Token": "secret"},
    )

    assert resp1.status_code == 200
    assert resp2.json().get("reason") == "duplicate"
