from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.config import settings
from apps.api.deps import get_database
from apps.api.integrations import telegram as telegram_integration
from apps.api.main import app


class FakeDB:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.artifacts: list[dict[str, Any]] = []

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        return self.runs.get(run_id)

    def create_artifact(  # type: ignore[no-untyped-def]
        self,
        *,
        run_id: str,
        artifact_type: str,
        url: str | None,
        provider: str,
        checksum: str | None,
        metadata,
        persona: str | None = None,
    ) -> None:
        self.artifacts.append(
            {
                "run_id": run_id,
                "artifact_type": artifact_type,
                "url": url,
                "provider": provider,
                "checksum": checksum,
                "metadata": metadata,
                "persona": persona,
            }
        )


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, FakeDB]]:
    # Avoid hitting real preflight checks during unit tests.
    from apps.api import startup as api_startup

    async def _noop(settings, app=None) -> None:  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(api_startup, "run_preflight_checks", _noop)

    fake_db = FakeDB()
    app.dependency_overrides[get_database] = lambda: fake_db

    with TestClient(app) as test_client:
        yield test_client, fake_db

    app.dependency_overrides.pop(get_database, None)


def test_notify_brendan_stores_notification_and_returns_metadata(client: tuple[TestClient, FakeDB]) -> None:
    test_client, fake_db = client
    fake_db.runs["run-123"] = {
        "run_id": "run-123",
        "project": "test_video_gen",
        "payload": json.dumps({"user_id": "user-001"}),
    }

    payload = {
        "notification_type": "awaiting_ideate",
        "message": "Run requires ideate approval",
        "gate": "ideate",
        "project": "test_video_gen",
    }

    response = test_client.post(
        "/v1/notifications/graph/run-123",
        json=payload,
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "notified"
    assert body["run_id"] == "run-123"
    assert body["user_id"] == "user-001"
    assert body["notification_type"] == "awaiting_ideate"
    assert body["gate"] == "ideate"

    assert fake_db.artifacts
    artifact = fake_db.artifacts[0]
    assert artifact["artifact_type"] == "notification"
    meta = artifact["metadata"]
    assert meta["type"] == "awaiting_ideate"
    assert meta["gate"] == "ideate"
    assert meta["project"] == "test_video_gen"
    assert meta["user_id"] == "user-001"


def test_notify_brendan_returns_404_when_run_missing(client: tuple[TestClient, FakeDB]) -> None:
    test_client, _ = client
    response = test_client.post(
        "/v1/notifications/graph/missing-run",
        json={
            "notification_type": "completed",
            "message": "done",
        },
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 404


def test_notify_brendan_forwards_telegram_updates(monkeypatch: pytest.MonkeyPatch, client: tuple[TestClient, FakeDB]) -> None:
    test_client, fake_db = client
    fake_db.runs["run-tg"] = {
        "run_id": "run-tg",
        "project": "aismr",
        "payload": json.dumps({"user_id": "telegram_999"}),
    }

    captured: list[dict[str, str]] = []

    async def _fake_send(chat_id: str, text: str, **_: Any) -> None:
        captured.append({"chat_id": chat_id, "text": text})

    monkeypatch.setattr(telegram_integration, "send_telegram_message", _fake_send)

    payload = {
        "notification_type": "awaiting_ideate",
        "message": "Run requires ideate approval",
        "gate": "ideate",
        "project": "aismr",
    }

    response = test_client.post(
        "/v1/notifications/graph/run-tg",
        json=payload,
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 200
    assert captured, "expected Telegram notifier to run"
    assert captured[0]["chat_id"] == "999"
    assert "Approve" in captured[0]["text"]
    assert "ideate" in captured[0]["text"]


def test_notify_brendan_sends_completion_update(monkeypatch: pytest.MonkeyPatch, client: tuple[TestClient, FakeDB]) -> None:
    test_client, fake_db = client
    fake_db.runs["run-done"] = {
        "run_id": "run-done",
        "project": "test_video_gen",
        "payload": json.dumps({"user_id": "telegram_123"}),
    }

    captured: list[dict[str, str]] = []

    async def _fake_send(chat_id: str, text: str, **_: Any) -> None:
        captured.append({"chat_id": chat_id, "text": text})

    monkeypatch.setattr(telegram_integration, "send_telegram_message", _fake_send)

    response = test_client.post(
        "/v1/notifications/graph/run-done",
        json={
            "notification_type": "completed",
            "message": "Run complete",
            "gate": None,
            "project": "test_video_gen",
        },
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 200
    assert captured
    assert captured[0]["chat_id"] == "123"
    assert "Run completed" in captured[0]["text"]
