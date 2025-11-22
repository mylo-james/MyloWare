from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.deps import get_database, get_video_gen_service


class FakeDB:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def record_webhook_event(  # type: ignore[override]
        self,
        *,
        idempotency_key: str,
        provider: str,
        headers,
        payload,
        signature_status: str,
    ) -> bool:
        self.events.append(
            {
                "idempotency_key": idempotency_key,
                "provider": provider,
                "headers": dict(headers),
                "payload_len": len(payload or b""),
                "signature_status": signature_status,
            }
        )
        return True


class FakeVideoGenService:
    def __init__(self) -> None:
        self.kieai_calls: list[tuple[dict[str, str], bytes, str | None]] = []
        self.upload_calls: list[tuple[dict[str, str], bytes]] = []
        self.kieai_response: dict[str, Any] = {"status": "queued"}
        self.upload_response: dict[str, Any] = {"status": "accepted"}

    def handle_kieai_event(self, *, headers: dict[str, str], payload: bytes, run_id: str | None) -> dict[str, Any]:  # type: ignore[override]
        self.kieai_calls.append((headers, payload, run_id))
        return dict(self.kieai_response)

    def handle_upload_post_webhook(self, *, headers: dict[str, str], payload: bytes) -> dict[str, Any]:  # type: ignore[override]
        self.upload_calls.append((headers, payload))
        return dict(self.upload_response)


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, FakeDB, FakeVideoGenService]]:
    from apps.api import startup as api_startup

    async def _noop(settings, app=None) -> None:  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(api_startup, "run_preflight_checks", _noop)
    fake_db = FakeDB()
    fake_service = FakeVideoGenService()
    app.dependency_overrides[get_database] = lambda: fake_db
    app.dependency_overrides[get_video_gen_service] = lambda: fake_service
    with TestClient(app) as test_client:
        yield test_client, fake_db, fake_service
    app.dependency_overrides.pop(get_database, None)
    app.dependency_overrides.pop(get_video_gen_service, None)


def _headers() -> dict[str, str]:
    return {
        "content-type": "application/json",
        "x-timestamp": str(int(time.time())),
        "x-request-id": "req-1",
        "x-signature": "deadbeef",
    }


def test_kieai_webhook_invokes_service(client: tuple[TestClient, FakeDB, FakeVideoGenService]) -> None:
    test_client, _, fake_service = client
    body = {"event": "clip.ready"}

    response = test_client.post(
        "/v1/webhooks/kieai?run_id=run-123",
        content=json.dumps(body),
        headers=_headers(),
    )

    assert response.status_code == 200
    assert response.json() == {"status": "queued"}

    assert fake_service.kieai_calls
    headers_passed, payload, run_id = fake_service.kieai_calls[0]
    assert headers_passed["x-request-id"] == "req-1"
    assert json.loads(payload.decode()) == body
    assert run_id == "run-123"


def test_kieai_webhook_rejects_invalid_signature(client: tuple[TestClient, FakeDB, FakeVideoGenService]) -> None:
    test_client, _, fake_service = client
    fake_service.kieai_response = {"status": "invalid"}

    response = test_client.post(
        "/v1/webhooks/kieai",
        content="{}",
        headers=_headers(),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "invalid signature"


def test_upload_post_webhook_surfaces_duplicate_status(client: tuple[TestClient, FakeDB, FakeVideoGenService]) -> None:
    test_client, _, fake_service = client
    fake_service.upload_response = {"status": "duplicate"}

    response = test_client.post(
        "/v1/webhooks/upload-post",
        content="{}",
        headers=_headers(),
    )

    assert response.status_code == 200
    assert response.json() == {"status": "duplicate"}

    assert fake_service.upload_calls
    headers_passed, payload = fake_service.upload_calls[0]
    assert headers_passed["x-request-id"] == "req-1"
    assert payload == b"{}"


def test_upload_post_webhook_rejects_invalid_signature(client: tuple[TestClient, FakeDB, FakeVideoGenService]) -> None:
    test_client, _, fake_service = client
    fake_service.upload_response = {"status": "invalid"}

    response = test_client.post(
        "/v1/webhooks/upload-post",
        content="{}",
        headers=_headers(),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "invalid signature"


def test_webhook_missing_signature_header_returns_400(client: tuple[TestClient, FakeDB, FakeVideoGenService]) -> None:
    test_client, fake_db, fake_service = client
    headers = _headers()
    headers.pop("x-signature")

    response = test_client.post(
        "/v1/webhooks/kieai",
        content="{}",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == fake_service.kieai_response
    assert fake_service.kieai_calls
    headers_passed, _, _ = fake_service.kieai_calls[-1]
    assert "x-signature" not in headers_passed


def test_webhook_missing_request_id_returns_400(client: tuple[TestClient, FakeDB, FakeVideoGenService]) -> None:
    test_client, _, fake_service = client
    headers = _headers()
    headers.pop("x-request-id")

    response = test_client.post(
        "/v1/webhooks/kieai",
        content="{}",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == fake_service.kieai_response
    assert fake_service.kieai_calls
    headers_passed, _, _ = fake_service.kieai_calls[-1]
    expected = f"kieai-{hashlib.sha256(b'{}').hexdigest()[:16]}"
    assert headers_passed["x-request-id"] == expected
