from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import HTTPException

from apps.api.routes.webhooks.common import validate_and_extract_webhook


class FakeDB:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def record_webhook_event(  # type: ignore[no-untyped-def]
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
            },
        )
        return True
    

class ExplodingDB(FakeDB):
    def record_webhook_event(  # type: ignore[override]
        self,
        *,
        idempotency_key: str,
        provider: str,
        headers,
        payload,
        signature_status: str,
    ) -> bool:
        raise RuntimeError("db unavailable")


class DummyRequest:
    def __init__(self, *, body: bytes, headers: dict[str, str]) -> None:
        self._body = body
        self.headers = headers

    async def body(self) -> bytes:
        return self._body


@pytest.mark.asyncio
async def test_validate_webhook_rejects_large_body() -> None:
    db = FakeDB()
    ts = int(datetime.now(UTC).timestamp())
    headers = {
        "x-timestamp": str(ts),
        "x-request-id": "large-body",
        "content-type": "application/json",
    }
    request = DummyRequest(body=b"x" * (1_000_000 + 1), headers=headers)

    with pytest.raises(HTTPException) as exc:
        await validate_and_extract_webhook(request, db=db, provider="kieai")

    assert exc.value.status_code == 413
    # No events recorded when body is rejected for size
    assert db.events == []


@pytest.mark.asyncio
async def test_validate_webhook_marks_stale_timestamp_and_logs(caplog: pytest.LogCaptureFixture) -> None:
    db = FakeDB()
    stale_ts = int((datetime.now(UTC) - timedelta(minutes=10)).timestamp())
    headers = {
        "x-timestamp": str(stale_ts),
        "x-request-id": "stale-123",
        "x-signature": "sig",
        "content-type": "application/json",
    }
    request = DummyRequest(body=b"{}", headers=headers)

    with caplog.at_level("WARNING", logger="myloware.api.webhooks"):
        headers_out, body = await validate_and_extract_webhook(request, db=db, provider="upload-post")
    assert body == b"{}"
    assert headers_out["x-request-id"] == "stale-123"
    assert headers_out["x-signature"] == "sig"
    assert any("replay window" in record.getMessage() for record in caplog.records)


@pytest.mark.asyncio
async def test_validate_webhook_accepts_missing_timestamp() -> None:
    db = FakeDB()
    headers = {
        "x-request-id": "missing-ts",
        "x-signature": "sig",
        "content-type": "application/json",
    }
    request = DummyRequest(body=b"{}", headers=headers)

    headers_out, body = await validate_and_extract_webhook(request, db=db, provider="kieai")
    assert body == b"{}"
    assert headers_out["x-request-id"] == "missing-ts"


@pytest.mark.asyncio
async def test_validate_webhook_tolerates_unused_db_dependency(
    caplog: pytest.LogCaptureFixture,
) -> None:
    db = ExplodingDB()
    stale_ts = int((datetime.now(UTC) - timedelta(minutes=10)).timestamp())
    headers = {
        "x-timestamp": str(stale_ts),
        "x-request-id": "stale-log",
        "x-signature": "sig",
        "content-type": "application/json",
    }
    request = DummyRequest(body=b"{}", headers=headers)

    with caplog.at_level("WARNING", logger="myloware.api.webhooks"):
        headers_out, _ = await validate_and_extract_webhook(request, db=db, provider="kieai")

    assert headers_out["x-request-id"] == "stale-log"
    assert any("replay window" in record.getMessage() for record in caplog.records)
