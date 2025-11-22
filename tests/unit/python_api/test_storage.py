from __future__ import annotations

import json
from typing import Any, List

import pytest

from adapters.persistence.db import database as db_module
from adapters.persistence.db.database import Database


class FakeConnection:
    def __init__(
        self,
        *,
        fetchone_result: Any = None,
        fetchall_result: list[Any] | None = None,
        rowcount: int = 0,
        raise_on_execute: Exception | None = None,
    ) -> None:
        self.fetchone_result = fetchone_result
        self.fetchall_result = fetchall_result or []
        self.rowcount_value = rowcount
        self.raise_on_execute = raise_on_execute
        self.executed: list[tuple[str, tuple[Any, ...] | None]] = []

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # noqa: D401
        return None

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> FakeConnection:
        self.executed.append((" ".join(query.split()), params))
        if self.raise_on_execute is not None:
            exc = self.raise_on_execute
            self.raise_on_execute = None
            raise exc
        return self

    def fetchone(self) -> Any:
        return self.fetchone_result

    def fetchall(self) -> list[Any]:
        return list(self.fetchall_result)

    def cursor(self) -> FakeConnection:
        return self

    @property
    def rowcount(self) -> int:
        return self.rowcount_value


def _set_connections(monkeypatch: pytest.MonkeyPatch, connections: List[FakeConnection]) -> None:
    monkeypatch.setattr(Database, "_connect", lambda self: connections.pop(0))


def test_create_run_inserts_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = FakeConnection()
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    payload = {"input": {"prompt": "demo"}, "graph_spec": {"pipeline": ["iggy", "riley", "alex", "quinn"]}}
    db.create_run(
        run_id="run-123",
        project="test_video_gen",
        status="pending",
        payload=payload,
    )

    assert conn.executed, "expected INSERT to run"
    query, params = conn.executed[0]
    assert "INSERT INTO runs" in query
    assert params[0] == "run-123"
    assert json.loads(params[3])["graph_spec"]["pipeline"] == ["iggy", "riley", "alex", "quinn"]


def test_record_webhook_event_handles_duplicates(monkeypatch: pytest.MonkeyPatch) -> None:
    class DuplicateError(Exception):
        pass

    monkeypatch.setattr(db_module.errors, "UniqueViolation", DuplicateError)
    duplicate_conn = FakeConnection(raise_on_execute=DuplicateError("dup"))
    _set_connections(monkeypatch, [duplicate_conn])
    db = Database("postgresql://localhost/mw")

    stored = db.record_webhook_event(
        idempotency_key="req-1",
        provider="upload-post",
        headers={"x-request-id": "req-1"},
        payload=b"{}",
        signature_status="verified",
    )

    assert stored is False

    success_conn = FakeConnection()
    _set_connections(monkeypatch, [success_conn])
    stored = db.record_webhook_event(
        idempotency_key="req-2",
        provider="kieai",
        headers={"x-request-id": "req-2"},
        payload=b"{ }",
        signature_status="accepted",
    )

    assert stored is True
    insert_query, params = success_conn.executed[0]
    assert "INSERT INTO webhook_events" in insert_query
    assert params[0] == "req-2"
    assert json.loads(params[2])["x-request-id"] == "req-2"
    assert any("DELETE FROM webhook_events" in sql for sql, _ in duplicate_conn.executed)
    assert any("DELETE FROM webhook_events" in sql for sql, _ in success_conn.executed[1:])


def test_get_and_list_artifacts_return_fetch_results(monkeypatch: pytest.MonkeyPatch) -> None:
    artifact_rows = [
        {"id": 1, "type": "run.start", "url": None, "provider": "api", "checksum": None, "metadata": {"foo": "bar"}},
    ]
    run_row = {"run_id": "run-123", "project": "test_video_gen"}
    _set_connections(monkeypatch, [FakeConnection(fetchone_result=run_row), FakeConnection(fetchall_result=artifact_rows)])
    db = Database("postgresql://localhost/mw")

    run = db.get_run("run-123")
    assert run == run_row

    artifacts = db.list_artifacts("run-123")
    assert artifacts == artifact_rows


def test_get_run_returns_none_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_connections(monkeypatch, [FakeConnection(fetchone_result=None)])
    db = Database("postgresql://localhost/mw")

    assert db.get_run("missing") is None


def test_prune_old_artifacts_returns_deleted_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = FakeConnection(rowcount=3)
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    deleted = db.prune_old_artifacts(older_than_days=30)

    assert deleted == 3
    # Ensure the correct table is targeted and the parameter is passed through.
    query, params = conn.executed[0]
    assert "DELETE FROM artifacts" in query
    assert params == (30,)


def test_prune_old_webhook_events_returns_deleted_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = FakeConnection(rowcount=5)
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    deleted = db.prune_old_webhook_events(older_than_days=14)

    assert deleted == 5
    query, params = conn.executed[0]
    assert "DELETE FROM webhook_events" in query
    assert params == (14,)


def test_list_webhook_events_converts_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {
            "id": "evt-1",
            "idempotency_key": "req-1",
            "provider": "kieai",
            "headers": {"x-request-id": "req-1"},
            "payload": memoryview(b"{}"),
            "signature_status": "verified",
            "received_at": "2025-11-14T15:32:00Z",
        }
    ]
    conn = FakeConnection(fetchall_result=rows)
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    events = db.list_webhook_events(limit=5)

    assert events == [{**rows[0], "payload": b"{}"}]
    query, params = conn.executed[0]
    assert "FROM webhook_events" in query
    # No provider filter should omit WHERE clauses.
    assert "provider = ANY" not in query
    assert params == (5,)


def test_list_webhook_events_accepts_provider_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {
            "id": "evt-2",
            "idempotency_key": "req-2",
            "provider": "upload-post",
            "headers": {"x-request-id": "req-2"},
            "payload": memoryview(b"{}"),
            "signature_status": "verified",
            "received_at": "2025-11-14T15:33:00Z",
        }
    ]
    conn = FakeConnection(fetchall_result=rows)
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    events = db.list_webhook_events(providers=["upload-post", "kieai"], limit=10)

    assert events[0]["provider"] == "upload-post"
    query, params = conn.executed[0]
    assert "provider = ANY" in query
    assert params == (["upload-post", "kieai"], 10)


def test_record_webhook_dlq_inserts_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = FakeConnection()
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    db.record_webhook_dlq(
        idempotency_key="req-1",
        provider="kieai",
        headers={"x-request-id": "req-1"},
        payload=b"{}",
        error="processing failed",
    )

    assert conn.executed, "expected INSERT into webhook_dlq"
    query, params = conn.executed[0]
    assert "INSERT INTO webhook_dlq" in query
    assert params[0] == "req-1"
    assert params[1] == "kieai"


def test_fetch_webhook_dlq_batch_uses_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [{"id": "1", "idempotency_key": "req-1"}]
    conn = FakeConnection(fetchall_result=rows)
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    result = db.fetch_webhook_dlq_batch(limit=10)

    assert result == rows
    query, params = conn.executed[0]
    assert "FROM webhook_dlq" in query
    assert params == (10,)


def test_delete_webhook_dlq_event_deletes_row(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = FakeConnection()
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    db.delete_webhook_dlq_event("deadbeef")

    query, params = conn.executed[0]
    assert "DELETE FROM webhook_dlq" in query
    assert params == ("deadbeef",)


def test_increment_webhook_dlq_retry_updates_retry_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    # Single connection is used for both SELECT and UPDATE.
    conn = FakeConnection(fetchone_result={"retry_count": 0})
    _set_connections(monkeypatch, [conn])
    db = Database("postgresql://localhost/mw")

    db.increment_webhook_dlq_retry(dlq_id="deadbeef", error="boom")

    assert len(conn.executed) == 2, "expected SELECT followed by UPDATE"
    assert "SELECT" in conn.executed[0][0]

    query, params = conn.executed[1]
    assert "UPDATE webhook_dlq" in query
    # First retry should set retry_count to 1 and target the provided id.
    assert params[0] == 1
    assert params[-1] == "deadbeef"
