from __future__ import annotations

from typing import Any

import pytest

from apps.orchestrator.checkpointer import PostgresCheckpointer


class FakeConnection:
    def __init__(self, row: tuple[Any, ...] | None = None) -> None:
        self.commands: list[tuple[str, tuple[Any, ...] | None]] = []
        self.row = row

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> "FakeConnection":
        self.commands.append((sql.strip(), params))
        return self

    def fetchone(self) -> tuple[Any, ...] | None:
        return self.row

    def close(self) -> None:
        return None


def _patch_psycopg(monkeypatch: pytest.MonkeyPatch, rows: list[tuple[Any, ...] | None]):
    connections: list[FakeConnection] = []

    def fake_connect(*args: Any, **kwargs: Any) -> FakeConnection:
        row = rows.pop(0) if rows else None
        conn = FakeConnection(row=row)
        connections.append(conn)
        return conn

    monkeypatch.setattr("apps.orchestrator.checkpointer.psycopg.connect", fake_connect)
    return connections


def test_checkpointer_save_and_load_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [None, None, ({"foo": "bar"},)]
    connections = _patch_psycopg(monkeypatch, rows)

    cp = PostgresCheckpointer("postgresql+psycopg://local/testdb")
    cp.save("run-123", {"state": "ok"})
    loaded = cp.load("run-123")

    assert loaded == {"foo": "bar"}
    # Ensure DSN normalization was applied
    assert cp._dsn == "postgresql://local/testdb"  # noqa: SLF001
    # Last connection executed SELECT with the provided run_id
    assert connections[-1].commands[-1][1] == ("run-123",)


def test_checkpointer_normalize_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_psycopg(monkeypatch, [None])
    cp = PostgresCheckpointer("postgresql://demo/test")
    assert cp._normalize_dsn("postgresql+psycopg://demo/db") == "postgresql://demo/db"
    assert cp._normalize_dsn("postgresql://demo/db") == "postgresql://demo/db"
