from __future__ import annotations

from typing import Any

import pytest

from adapters.persistence.vector import pgvector


class FakeConn:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []
        self.commands: list[tuple[str, tuple[Any, ...] | None]] = []

    def execute(self, sql: str, params: tuple[Any, ...] | None = None):
        self.commands.append((sql.strip(), params))
        if "SELECT indexname" in sql or "SELECT idx.indexrelid" in sql:
            return FakeCursor(self.rows)
        return self

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeCursor:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def fetchall(self):
        return self._rows


def test_ensure_extension_executes_sql(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_conn = FakeConn()
    monkeypatch.setattr(pgvector, "_PSYCOPG", True, raising=False)
    monkeypatch.setattr(pgvector, "_connect", lambda dsn: fake_conn, raising=False)

    pgvector.ensure_extension("postgresql://demo")

    assert "CREATE EXTENSION IF NOT EXISTS vector;" in fake_conn.commands[0][0]


def test_create_hnsw_index_uses_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_conn = FakeConn()
    monkeypatch.setattr(pgvector, "_PSYCOPG", True, raising=False)
    monkeypatch.setattr(pgvector, "_connect", lambda dsn: fake_conn, raising=False)

    pgvector.create_hnsw_index("postgresql://demo", table="kb_embeddings")

    sql = fake_conn.commands[0][0]
    assert "CREATE INDEX IF NOT EXISTS kb_embeddings_embedding_hnsw_idx" in sql
    assert "USING hnsw (embedding vector_l2_ops)" in sql


def test_drop_vector_indexes_drops_matching(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [{"indexname": "kb_embeddings_embedding_hnsw_idx"}, {"indexname": "skip_me"}]
    fake_conn = FakeConn(rows=rows)
    monkeypatch.setattr(pgvector, "_PSYCOPG", True, raising=False)
    monkeypatch.setattr(pgvector, "_connect", lambda dsn: fake_conn, raising=False)

    count = pgvector.drop_vector_indexes("postgresql://demo", table="kb_embeddings", prefix="kb_embeddings")

    assert count == 1
    # First command is SELECT, subsequent drop executes on matching index
    assert any("DROP INDEX IF EXISTS kb_embeddings_embedding_hnsw_idx;" in cmd[0] for cmd in fake_conn.commands[1:])


def test_index_stats_returns_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {"name": "kb_embeddings_embedding_hnsw_idx", "method": "hnsw", "bytes": 1024},
    ]
    fake_conn = FakeConn(rows=rows)
    monkeypatch.setattr(pgvector, "_PSYCOPG", True, raising=False)
    monkeypatch.setattr(pgvector, "_connect", lambda dsn: fake_conn, raising=False)

    stats = pgvector.index_stats("postgresql://demo", table="kb_embeddings")

    assert stats == [{"name": "kb_embeddings_embedding_hnsw_idx", "method": "hnsw", "bytes": 1024}]


def test_index_stats_returns_empty_when_no_indexes(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_conn = FakeConn(rows=[])
    monkeypatch.setattr(pgvector, "_PSYCOPG", True, raising=False)
    monkeypatch.setattr(pgvector, "_connect", lambda dsn: fake_conn, raising=False)

    stats = pgvector.index_stats("postgresql://demo", table="kb_embeddings")

    assert stats == []
