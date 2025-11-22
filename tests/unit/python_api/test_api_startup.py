from __future__ import annotations

import pytest

from fastapi import FastAPI

from apps.api import startup as api_startup
from apps.api.config import Settings


def _metrics_ready_app() -> FastAPI:
    app = FastAPI()

    @app.get("/metrics")
    async def metrics() -> str:
        return "ok"

    return app


def _staging_settings(**overrides: object) -> Settings:
    base = {
        "environment": "staging",
        "api_key": "staging-api-key-123456",
        "kieai_api_key": "staging-kieai-key-123456",
        "kieai_signing_secret": "staging-kieai-secret-456",
        "shotstack_api_key": "staging-shotstack-key-456",
        "upload_post_api_key": "staging-upload-key-789",
        "upload_post_signing_secret": "staging-upload-secret-789",
    }
    base.update(overrides)
    return Settings(**base)


@pytest.mark.anyio
async def test_run_preflight_checks_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    async def fake_check_db(dsn: str) -> None:
        calls.append(("db", dsn))

    async def fake_check_redis(url: str) -> None:
        calls.append(("redis", url))

    def fake_check_migrations(dsn: str) -> None:
        calls.append(("migrations", dsn))

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", fake_check_redis)
    monkeypatch.setattr(api_startup, "check_migrations_current", fake_check_migrations)

    settings = Settings()
    setattr(settings, "strict_startup_checks", False)
    await api_startup.run_preflight_checks(settings)

    # Ensure each check was invoked with the expected settings.
    assert ("db", settings.db_url) in calls
    assert ("redis", settings.redis_url) in calls
    assert any(call[0] == "migrations" and call[1] == settings.db_url for call in calls)


@pytest.mark.anyio
async def test_run_preflight_checks_propagates_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_db(_dsn: str) -> None:
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(api_startup, "check_db_connectivity", failing_db)
    # Stub the remaining checks so they would be no-ops if reached.
    monkeypatch.setattr(api_startup, "check_redis_connectivity", lambda *_: None)
    monkeypatch.setattr(api_startup, "check_migrations_current", lambda *_: None)

    settings = Settings()
    setattr(settings, "strict_startup_checks", False)
    with pytest.raises(RuntimeError):
        await api_startup.run_preflight_checks(settings)


@pytest.mark.anyio
async def test_run_preflight_checks_non_strict_migrations_warn_only(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls: list[str] = []

    async def fake_check_db(_dsn: str) -> None:
        calls.append("db")

    async def fake_check_redis(_url: str) -> None:
        calls.append("redis")

    def failing_migrations(_dsn: str) -> None:
        calls.append("migrations")
        raise RuntimeError("migrations out of date")

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", fake_check_redis)
    monkeypatch.setattr(api_startup, "check_migrations_current", failing_migrations)

    caplog.set_level("WARNING")
    settings = Settings(environment="local")
    # Explicitly ensure non-strict mode in local/dev.
    setattr(settings, "strict_startup_checks", False)

    await api_startup.run_preflight_checks(settings)

    # Migration failure should be logged as a warning but not raise.
    assert any(entry.levelname == "WARNING" for entry in caplog.records)
    assert "migrations check failed in non-strict mode" in caplog.text.lower()
    # Other checks should still have been executed.
    assert "db" in calls and "redis" in calls and "migrations" in calls


@pytest.mark.anyio
async def test_run_preflight_checks_strict_mode_raises_on_migration_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    async def fake_check_redis(_url: str) -> None:
        return None

    def failing_migrations(_dsn: str) -> None:
        raise RuntimeError("migrations out of date")

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", fake_check_redis)
    monkeypatch.setattr(api_startup, "check_migrations_current", failing_migrations)

    # Strict mode via environment variable should cause migration failures to be fatal in local.
    settings = Settings(environment="local")
    setattr(settings, "strict_startup_checks", True)

    with pytest.raises(RuntimeError):
        await api_startup.run_preflight_checks(settings, app=_metrics_ready_app())


@pytest.mark.anyio
async def test_run_preflight_checks_requires_metrics_endpoint_in_strict_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    async def fake_check_redis(_url: str) -> None:
        return None

    def fake_check_migrations(_dsn: str) -> None:
        return None

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", fake_check_redis)
    monkeypatch.setattr(api_startup, "check_migrations_current", fake_check_migrations)

    settings = Settings(environment="local")
    setattr(settings, "strict_startup_checks", True)

    # App without /metrics should fail the strict metrics check.
    with pytest.raises(RuntimeError):
        await api_startup.run_preflight_checks(settings, app=FastAPI())


@pytest.mark.anyio
async def test_run_preflight_checks_staging_requires_metrics_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    async def fake_check_redis(_url: str) -> None:
        return None

    def fake_check_migrations(_dsn: str) -> None:
        return None

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", fake_check_redis)
    monkeypatch.setattr(api_startup, "check_migrations_current", fake_check_migrations)
    monkeypatch.setattr(api_startup.Settings, "_validate_secrets", lambda self: self)
    monkeypatch.setenv("HITL_SECRET", "staging-hitl-secret-999")

    settings = _staging_settings()

    with pytest.raises(RuntimeError):
        await api_startup.run_preflight_checks(settings, app=FastAPI())


@pytest.mark.anyio
async def test_run_preflight_checks_redis_failure_warns_when_rate_limiting_disabled(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    async def failing_redis(_url: str) -> None:
        raise RuntimeError("redis unavailable")

    def fake_check_migrations(_dsn: str) -> None:
        return None

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", failing_redis)
    monkeypatch.setattr(api_startup, "check_migrations_current", fake_check_migrations)

    caplog.set_level("WARNING")
    # Use local environment to avoid strict secret validation while still
    # exercising the Redis gating logic.
    settings = Settings(environment="local")
    setattr(settings, "use_redis_rate_limiting", False)
    setattr(settings, "strict_startup_checks", False)

    # Redis failures should be logged as a warning but not raise when rate limiting is disabled.
    await api_startup.run_preflight_checks(settings)
    assert "redis connectivity check failed with rate limiting disabled; continuing startup" in caplog.text.lower()


@pytest.mark.anyio
async def test_run_preflight_checks_redis_failure_raises_when_rate_limiting_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    async def failing_redis(_url: str) -> None:
        raise RuntimeError("redis unavailable")

    def fake_check_migrations(_dsn: str) -> None:
        return None

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", failing_redis)
    monkeypatch.setattr(api_startup, "check_migrations_current", fake_check_migrations)

    settings = Settings(environment="local")
    setattr(settings, "use_redis_rate_limiting", True)
    setattr(settings, "strict_startup_checks", False)

    # When rate limiting is enabled, Redis failures should be fatal.
    with pytest.raises(RuntimeError):
        await api_startup.run_preflight_checks(settings)


@pytest.mark.anyio
async def test_run_preflight_checks_auto_migrates_when_no_revision_in_strict_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_db(_dsn: str) -> None:
        return None

    async def fake_check_redis(_url: str) -> None:
        return None

    calls: list[str] = []

    def fake_check_migrations(_dsn: str) -> None:
        calls.append("check")
        # First call simulates no alembic_version (current=None); second call passes.
        if len(calls) == 1:
            raise ValueError("Migrations not current: current=None, head=20251113_03_add_hitl_approvals_table")

    def fake_run_alembic() -> None:
        calls.append("alembic")

    monkeypatch.setattr(api_startup, "check_db_connectivity", fake_check_db)
    monkeypatch.setattr(api_startup, "check_migrations_current", fake_check_migrations)
    monkeypatch.setattr(api_startup, "check_redis_connectivity", fake_check_redis)
    monkeypatch.setattr(api_startup, "_run_alembic_upgrade_head", fake_run_alembic)

    # Strict mode via flag in a local environment to avoid staging/prod secret
    # validation while still exercising the strict branch.
    settings = Settings(environment="local")
    setattr(settings, "strict_startup_checks", True)

    await api_startup.run_preflight_checks(settings, app=_metrics_ready_app())

    # Expect the sequence: initial check (raises), auto-migrate, second check.
    assert calls == ["check", "alembic", "check"]


@pytest.mark.anyio
async def test_check_db_connectivity_normalizes_dsn_and_executes(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyConn:
        def __init__(self) -> None:
            self.executed: list[str] = []

        def execute(self, sql: str, *_: object, **__: object) -> None:
            self.executed.append(sql)

        def close(self) -> None:
            return None

    dummy = DummyConn()

    class DummyPsycopg:
        def __init__(self) -> None:
            self.dsn: str | None = None

        def connect(self, dsn: str, autocommit: bool = False) -> DummyConn:  # noqa: D401
            self.dsn = dsn
            return dummy

    fake_psycopg = DummyPsycopg()
    monkeypatch.setattr(api_startup, "psycopg", fake_psycopg)

    dsn = "postgresql+psycopg://user:pass@localhost/db"
    await api_startup.check_db_connectivity(dsn)

    assert fake_psycopg.dsn == "postgresql://user:pass@localhost/db"
    assert "SELECT 1" in dummy.executed


@pytest.mark.anyio
async def test_check_redis_connectivity_skips_when_not_available(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("WARNING")
    monkeypatch.setattr(api_startup, "redis_available", lambda: False)

    await api_startup.check_redis_connectivity("redis://localhost:6379/0")

    assert "Redis not available, skipping connectivity check" in caplog.text


@pytest.mark.anyio
async def test_check_redis_connectivity_pings_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def fake_ping(url: str) -> None:
        calls.append(url)

    monkeypatch.setattr(api_startup, "redis_available", lambda: True)
    monkeypatch.setattr(api_startup, "redis_ping", fake_ping)

    url = "redis://localhost:6379/1"
    await api_startup.check_redis_connectivity(url)

    assert calls == [url]


@pytest.mark.anyio
async def test_lifespan_exits_on_preflight_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_preflight(_settings: Settings) -> None:
        raise RuntimeError("boom")

    exit_called: dict[str, object] = {}

    def fake_exit(code: int) -> None:  # noqa: D401
        exit_called["code"] = code
        raise SystemExit(code)

    monkeypatch.setattr(api_startup, "run_preflight_checks", failing_preflight)
    monkeypatch.setattr(api_startup.sys, "exit", fake_exit)

    lifespan_ctx = api_startup.lifespan(app=FastAPI())
    with pytest.raises(SystemExit) as exc:
        async with lifespan_ctx:
            pass
    assert exc.value.code == 1
    assert exit_called["code"] == 1
