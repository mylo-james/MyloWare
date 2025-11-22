from __future__ import annotations

import json
from typing import Any

import pytest

from cli import main as cli_main


class _RecordingDB:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self.fetched_limits: list[int] = []
        self.deleted: list[str] = []
        self.retried: list[dict[str, str]] = []
        self._batch: list[dict[str, Any]] = [
            {
                "id": "1",
                "idempotency_key": "req-1",
                "provider": "kieai",
                "headers": {"content-type": "application/json", "x-request-id": "req-1"},
                "payload": b'{"ok":true}',
                "error": "previous failure",
                "retry_count": 0,
            }
        ]

    # Database API expected by the CLI helper.
    def fetch_webhook_dlq_batch(self, *, limit: int = 50) -> list[dict[str, Any]]:
        self.fetched_limits.append(limit)
        return list(self._batch)

    def delete_webhook_dlq_event(self, dlq_id: str) -> None:
        self.deleted.append(dlq_id)

    def increment_webhook_dlq_retry(self, *, dlq_id: str, error: str, **_: Any) -> None:
        self.retried.append({"id": dlq_id, "error": error})


def test_dlq_replay_webhooks_dry_run(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    created: list[_RecordingDB] = []

    def fake_db_factory(dsn: str) -> _RecordingDB:
        db = _RecordingDB(dsn)
        created.append(db)
        return db

    monkeypatch.setenv("DB_URL", "postgresql://localhost/myloware")
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")
    monkeypatch.setattr("adapters.persistence.db.database.Database", fake_db_factory)

    exit_code = cli_main.main(["dlq", "replay-webhooks", "--limit", "5", "--dry-run"])

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "[dry-run] Would replay webhook DLQ events" in out
    summary = json.loads(out.split("\n", 1)[1])
    assert summary["count"] == 1
    assert created, "expected Database to be instantiated"
    assert created[0].fetched_limits == [5]
    # Dry-run should not delete or retry any entries.
    assert created[0].deleted == []
    assert created[0].retried == []


def test_dlq_replay_webhooks_replays_successfully(monkeypatch: pytest.MonkeyPatch) -> None:
    db = _RecordingDB("postgresql://localhost/myloware")

    def fake_db_factory(dsn: str) -> _RecordingDB:
        assert dsn == db.dsn
        return db

    class FakeResponse:
        def __init__(self, status_code: int = 200) -> None:
            self.status_code = status_code

        def raise_for_status(self) -> None:  # pragma: no cover - success path only
            if self.status_code >= 400:
                raise RuntimeError("http error")

    clients: list[FakeClient] = []

    class FakeClient:
        def __init__(self, *_, **__) -> None:
            self.posts: list[dict[str, Any]] = []
            clients.append(self)

        def __enter__(self) -> "FakeClient":  # type: ignore[override]
            return self

        def __exit__(self, *exc_info: object) -> None:  # type: ignore[override]
            return None

        def post(self, url: str, headers: dict[str, str] | None = None, content: bytes | None = None) -> FakeResponse:  # noqa: D401, ANN401
            self.posts.append({"url": url, "headers": headers or {}, "content": content or b""})
            return FakeResponse()

    monkeypatch.setenv("DB_URL", db.dsn)
    monkeypatch.setenv("API_BASE_URL", "http://api.test")
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")
    monkeypatch.setattr("adapters.persistence.db.database.Database", fake_db_factory)
    monkeypatch.setattr(cli_main.httpx, "Client", FakeClient)  # type: ignore[assignment]

    exit_code = cli_main.main(["dlq", "replay-webhooks", "--limit", "10"])

    assert exit_code == 0
    assert clients, "expected httpx.Client to be instantiated"
    client = clients[0]
    assert any(call["url"].endswith("/v1/webhooks/kieai") for call in client.posts)
    # The DLQ entry should have been deleted, not retried.
    assert db.deleted == ["1"]
    assert db.retried == []
