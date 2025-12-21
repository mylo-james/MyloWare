"""Unit tests for storage database helpers."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from myloware.storage import database as db


@pytest.fixture(autouse=True)
def _reset_db_singletons(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr(db, "_engine_url", None)
    monkeypatch.setattr(db, "_SessionLocal", None)
    monkeypatch.setattr(db, "_async_engine", None)
    monkeypatch.setattr(db, "_async_engine_url", None)
    monkeypatch.setattr(db, "_async_engine_loop_id", None)
    monkeypatch.setattr(db, "_AsyncSessionLocal", None)


def test_get_engine_sets_pool_size_for_non_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    create_engine = Mock(return_value=object())
    monkeypatch.setattr(db, "create_engine", create_engine)
    monkeypatch.setattr(db.settings, "database_url", "postgresql://example")
    monkeypatch.setattr(db.settings, "db_pool_size", 7)
    monkeypatch.setattr(db.settings, "db_max_overflow", 11)

    db.get_engine()

    _url, kwargs = create_engine.call_args
    assert kwargs["pool_size"] == 7
    assert kwargs["max_overflow"] == 11


def test_get_async_engine_loop_id_is_none_without_running_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(db.settings, "database_url", "sqlite:///:memory:")

    create_async_engine = Mock(
        return_value=SimpleNamespace(sync_engine=SimpleNamespace(dispose=Mock()))
    )
    monkeypatch.setattr(db, "create_async_engine", create_async_engine)

    db.get_async_engine()
    assert create_async_engine.call_count == 1


@pytest.mark.asyncio
async def test_get_async_engine_converts_postgres_driver_and_uses_null_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(db.settings, "database_url", "postgresql+psycopg2://example")
    monkeypatch.setattr(db.settings, "async_use_pool", False)

    create_async_engine = Mock(
        return_value=SimpleNamespace(sync_engine=SimpleNamespace(dispose=Mock()))
    )
    monkeypatch.setattr(db, "create_async_engine", create_async_engine)

    db.get_async_engine()

    (url,), kwargs = create_async_engine.call_args
    assert url.startswith("postgresql+asyncpg://")
    assert kwargs.get("poolclass") is db.NullPool


@pytest.mark.asyncio
async def test_get_async_engine_uses_pool_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db.settings, "database_url", "postgresql+psycopg2://example")
    monkeypatch.setattr(db.settings, "async_use_pool", True)
    monkeypatch.setattr(db.settings, "db_pool_size", 5)
    monkeypatch.setattr(db.settings, "db_max_overflow", 9)

    create_async_engine = Mock(
        return_value=SimpleNamespace(sync_engine=SimpleNamespace(dispose=Mock()))
    )
    monkeypatch.setattr(db, "create_async_engine", create_async_engine)

    db.get_async_engine()

    (_url,), kwargs = create_async_engine.call_args
    assert kwargs.get("pool_size") == 5
    assert kwargs.get("max_overflow") == 9


@pytest.mark.asyncio
async def test_get_async_engine_converts_sqlite_url_to_aiosqlite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(db.settings, "database_url", "sqlite:///:memory:")

    create_async_engine = Mock(
        return_value=SimpleNamespace(sync_engine=SimpleNamespace(dispose=Mock()))
    )
    monkeypatch.setattr(db, "create_async_engine", create_async_engine)

    db.get_async_engine()

    (url,), _kwargs = create_async_engine.call_args
    assert url.startswith("sqlite+aiosqlite://")


@pytest.mark.asyncio
async def test_init_async_db_enables_wal_for_sqlite_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db.settings, "database_url", "sqlite+aiosqlite:///tmp/test.db")

    conn = SimpleNamespace(run_sync=AsyncMock(), execute=AsyncMock())

    class FakeBegin:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return conn

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    engine = SimpleNamespace(begin=lambda: FakeBegin())
    monkeypatch.setattr(db, "get_async_engine", lambda: engine)

    await db.init_async_db()

    assert conn.run_sync.await_count == 1
    assert conn.execute.await_count == 4


def test_init_db_logs_warning_when_wal_setup_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db.settings, "database_url", "sqlite:///tmp/test.db")

    monkeypatch.setattr(db.Base.metadata, "create_all", Mock())

    class FakeBegin:
        def __enter__(self):  # type: ignore[no-untyped-def]
            raise RuntimeError("boom")

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return False

    engine = SimpleNamespace(begin=lambda: FakeBegin())
    monkeypatch.setattr(db, "get_engine", lambda: engine)

    db.init_db()
