from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI

from apps.orchestrator import startup as orch_startup
from apps.orchestrator.config import Settings


def _metrics_ready_app() -> FastAPI:
    app = FastAPI()

    @app.get("/metrics")
    async def metrics() -> str:
        return "ok"

    return app


def _staging_settings(**overrides: object) -> Settings:
    base = {
        "environment": "staging",
        "api_key": "staging-orch-key-123456",
        "kieai_api_key": "staging-kieai-key-123456",
        "kieai_signing_secret": "staging-kieai-signing-secret-123456",
        "shotstack_api_key": "staging-shotstack-key-123456",
        "upload_post_api_key": "staging-upload-key-789",
        "upload_post_signing_secret": "staging-upload-signing-secret-123456",
    }
    base.update(overrides)
    return Settings(**base)


@pytest.mark.anyio
async def test_run_preflight_checks_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    async def fake_check_db(dsn: str) -> None:
        calls.append(("db", dsn))

    def fake_check_migrations(dsn: str) -> None:
        calls.append(("migrations", dsn))

    monkeypatch.setattr(orch_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(orch_startup, "check_migrations_current", fake_check_migrations)

    settings = Settings()
    setattr(settings, "strict_startup_checks", False)
    await orch_startup.run_preflight_checks(settings)

    assert ("db", settings.db_url) in calls
    assert any(call[0] == "migrations" and call[1] == settings.db_url for call in calls)


@pytest.mark.anyio
async def test_run_preflight_checks_propagates_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_db(_dsn: str) -> None:
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(orch_startup, "check_db_connectivity", failing_db)
    monkeypatch.setattr(orch_startup, "check_migrations_current", lambda *_: None)

    settings = Settings()
    setattr(settings, "strict_startup_checks", False)
    with pytest.raises(RuntimeError):
        await orch_startup.run_preflight_checks(settings)


@pytest.mark.anyio
async def test_run_preflight_checks_non_strict_migrations_warn_only(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls: list[str] = []

    async def fake_check_db(_dsn: str) -> None:
        calls.append("db")

    def failing_migrations(_dsn: str) -> None:
        calls.append("migrations")
        raise RuntimeError("migrations out of date")

    monkeypatch.setattr(orch_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(orch_startup, "check_migrations_current", failing_migrations)

    caplog.set_level("WARNING")
    settings = Settings(environment="local")
    setattr(settings, "strict_startup_checks", False)

    await orch_startup.run_preflight_checks(settings)

    # Migration failures should be logged but not raise in non-strict mode.
    assert any(entry.levelname == "WARNING" for entry in caplog.records)
    assert "migrations check failed in non-strict mode" in caplog.text.lower()
    assert "db" in calls and "migrations" in calls


@pytest.mark.anyio
async def test_run_preflight_checks_strict_mode_raises_on_migration_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    def failing_migrations(_dsn: str) -> None:
        raise RuntimeError("migrations out of date")

    monkeypatch.setattr(orch_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(orch_startup, "check_migrations_current", failing_migrations)

    # Strict mode should treat migration failures as fatal even in local.
    settings = Settings(environment="local")
    setattr(settings, "strict_startup_checks", True)

    with pytest.raises(RuntimeError):
        await orch_startup.run_preflight_checks(settings, app=_metrics_ready_app())


@pytest.mark.anyio
async def test_run_preflight_checks_requires_metrics_endpoint_in_strict_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    def fake_check_migrations(_dsn: str) -> None:
        return None

    monkeypatch.setattr(orch_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(orch_startup, "check_migrations_current", fake_check_migrations)

    settings = Settings(environment="local")
    setattr(settings, "strict_startup_checks", True)

    with pytest.raises(RuntimeError):
        await orch_startup.run_preflight_checks(settings, app=FastAPI())


@pytest.mark.anyio
async def test_run_preflight_checks_staging_requires_metrics_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    def fake_check_migrations(_dsn: str) -> None:
        return None

    monkeypatch.setattr(orch_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(orch_startup, "check_migrations_current", fake_check_migrations)
    monkeypatch.setattr(orch_startup.Settings, "_validate_prod_keys", lambda self: self)

    settings = _staging_settings()

    with pytest.raises(RuntimeError):
        await orch_startup.run_preflight_checks(settings, app=FastAPI())


@pytest.mark.anyio
async def test_check_db_connectivity_normalizes_dsn_and_executes(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyConn:
        def __init__(self) -> None:
            self.executed: list[str] = []

        def execute(self, sql: str, *_: Any, **__: Any) -> None:
            self.executed.append(sql)

        def close(self) -> None:  # noqa: D401
            return None

    dummy = DummyConn()

    class DummyPsycopg:
        def __init__(self) -> None:
            self.dsn: str | None = None

        def connect(self, dsn: str, autocommit: bool = False) -> DummyConn:  # noqa: D401
            self.dsn = dsn
            return dummy

    fake_psycopg = DummyPsycopg()
    monkeypatch.setattr(orch_startup, "psycopg", fake_psycopg)

    dsn = "postgresql+psycopg://user:pass@localhost/db"
    await orch_startup.check_db_connectivity(dsn)

    assert fake_psycopg.dsn == "postgresql://user:pass@localhost/db"
    assert "SELECT 1" in dummy.executed


@pytest.mark.anyio
async def test_lifespan_exits_on_preflight_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_preflight(_settings: Settings) -> None:
        raise RuntimeError("boom")

    exit_called: dict[str, Any] = {}

    def fake_exit(code: int) -> None:  # noqa: D401
        exit_called["code"] = code
        raise SystemExit(code)

    monkeypatch.setattr(orch_startup, "run_preflight_checks", failing_preflight)
    monkeypatch.setattr(orch_startup.sys, "exit", fake_exit)

    lifespan_ctx = orch_startup.lifespan(app=FastAPI())
    with pytest.raises(SystemExit) as exc:
        async with lifespan_ctx:
            pass
    assert exc.value.code == 1
    assert exit_called["code"] == 1
