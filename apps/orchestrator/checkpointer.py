"""Postgres-backed checkpointing stub used by LangGraph."""
from __future__ import annotations

import json
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any, cast

import psycopg


class PostgresCheckpointer:
    """Very small checkpoint adapter that persists run state to Postgres."""

    @staticmethod
    def _json_default(value: object) -> str | dict[str, object]:
        """Best-effort JSON serializer for non-serializable objects."""
        from collections.abc import Mapping

        if isinstance(value, Mapping):
            return dict(value)
        if hasattr(value, "__dict__"):
            try:
                # Snapshot the object's dictionary for serialization
                return dict(getattr(value, "__dict__"))
            except Exception:
                pass
        return str(value)

    def __init__(self, dsn: str) -> None:
        self._dsn = self._normalize_dsn(dsn)
        self._ensure_table()

    @contextmanager
    def _connection(self) -> Generator[psycopg.Connection, None, None]:
        conn = psycopg.connect(self._dsn, autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    def _ensure_table(self) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS orchestration_checkpoints (
                    run_id TEXT PRIMARY KEY,
                    state JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                """
            )

    def save(self, run_id: str, state: dict[str, Any]) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO orchestration_checkpoints (run_id, state)
                VALUES (%s, %s)
                ON CONFLICT (run_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW();
                """,
                (run_id, json.dumps(state, default=self._json_default)),
            )

    def load(self, run_id: str) -> dict[str, Any] | None:
        with self._connection() as conn:
            row = conn.execute(
                "SELECT state FROM orchestration_checkpoints WHERE run_id = %s", (run_id,)
            ).fetchone()
        if not row:
            return None
        return cast(dict[str, Any], row[0])

    def _normalize_dsn(self, dsn: str) -> str:
        if dsn.startswith("postgresql+"):
            return dsn.replace("postgresql+psycopg", "postgresql", 1)
        return dsn
