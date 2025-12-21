"""Unit tests for health endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.anyio
async def test_health_basic(async_client) -> None:
    resp = await async_client.get("/health")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "healthy"
    assert payload["degraded_mode"] is True  # test env uses fake providers
    assert "provider_modes" in payload


@pytest.mark.anyio
async def test_health_deep_in_fake_mode_sets_reachable_false(async_client) -> None:
    resp = await async_client.get("/health?deep=true")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["llama_stack_reachable"] is False
    assert "LLAMA_STACK_PROVIDER=" in payload["llama_stack_error"]


@pytest.mark.anyio
async def test_health_deep_real_mode_lists_models(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "llama_stack_provider", "real")

    async def fake_list_models_async(_client):
        return ["m1", "m2", "m3", "m4", "m5", "m6"]

    monkeypatch.setattr("myloware.llama_clients.get_async_client", lambda: object())
    monkeypatch.setattr("myloware.llama_clients.list_models_async", fake_list_models_async)

    resp = await async_client.get("/health?deep=true")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["llama_stack_reachable"] is True
    assert payload["llama_stack_models"] == ["m1", "m2", "m3", "m4", "m5"]


@pytest.mark.anyio
async def test_health_langgraph_reports_unhealthy(async_client, monkeypatch) -> None:
    async def fake_check(_engine):
        return False

    monkeypatch.setattr("myloware.api.routes.health.check_checkpointer_health", fake_check)
    resp = await async_client.get("/health/langgraph")
    assert resp.status_code == 503
    assert resp.json()["langgraph_checkpointer"] == "unhealthy"


@pytest.mark.anyio
async def test_health_db_reports_unhealthy_when_engine_raises(async_client, monkeypatch) -> None:
    monkeypatch.setattr(
        "myloware.storage.database.get_engine",
        lambda: (_ for _ in ()).throw(RuntimeError("db down")),
    )
    resp = await async_client.get("/health/db")
    assert resp.status_code == 503
    payload = resp.json()
    assert payload["database"] == "unhealthy"
    assert "db down" in payload["database_error"]


@pytest.mark.anyio
async def test_health_db_reports_healthy_and_migrations_up_to_date(
    async_client, monkeypatch
) -> None:
    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeMigrationContext:
        @staticmethod
        def configure(_conn):
            return SimpleNamespace(get_current_revision=lambda: "rev1")

    class FakeConfig:
        def __init__(self, _path: str):
            pass

    class FakeScriptDirectory:
        @staticmethod
        def from_config(_cfg):
            return SimpleNamespace(get_current_head=lambda: "rev1")

    monkeypatch.setattr("alembic.runtime.migration.MigrationContext", FakeMigrationContext)
    monkeypatch.setattr("alembic.config.Config", FakeConfig)
    monkeypatch.setattr("alembic.script.ScriptDirectory", FakeScriptDirectory)

    resp = await async_client.get("/health/db")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["database"] == "healthy"
    assert payload["migration_current"] == "rev1"
    assert payload["migration_head"] == "rev1"
    assert payload["migrations_up_to_date"] is True


@pytest.mark.anyio
async def test_health_db_reports_pending_migrations(async_client, monkeypatch) -> None:
    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeMigrationContext:
        @staticmethod
        def configure(_conn):
            return SimpleNamespace(get_current_revision=lambda: "rev1")

    class FakeConfig:
        def __init__(self, _path: str):
            pass

    class FakeScriptDirectory:
        @staticmethod
        def from_config(_cfg):
            return SimpleNamespace(get_current_head=lambda: "rev2")

    monkeypatch.setattr("alembic.runtime.migration.MigrationContext", FakeMigrationContext)
    monkeypatch.setattr("alembic.config.Config", FakeConfig)
    monkeypatch.setattr("alembic.script.ScriptDirectory", FakeScriptDirectory)

    resp = await async_client.get("/health/db")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["database"] == "healthy"
    assert payload["migrations_up_to_date"] is False
    assert payload["migration_status"] == "migrations_pending"


@pytest.mark.anyio
async def test_health_stuck_runs_endpoint(async_client, monkeypatch) -> None:
    monkeypatch.setattr(
        "myloware.workflows.cleanup.get_stuck_runs",
        lambda timeout_minutes=60: [{"run_id": "r1", "minutes_waiting": timeout_minutes}],
    )
    resp = await async_client.get("/health/stuck-runs?timeout_minutes=5")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] == 1
    assert payload["stuck_runs"][0]["minutes_waiting"] == 5


@pytest.mark.anyio
async def test_health_cleanup_stuck_runs_endpoint(async_client, monkeypatch) -> None:
    timed_out = [uuid4()]
    monkeypatch.setattr(
        "myloware.workflows.cleanup.timeout_stuck_runs",
        lambda timeout_minutes=60, dry_run=True: timed_out,
    )
    resp = await async_client.post("/health/cleanup-stuck-runs?timeout_minutes=1&dry_run=false")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["dry_run"] is False
    assert payload["timed_out_run_ids"] == [str(timed_out[0])]


@pytest.mark.anyio
async def test_health_full_returns_200_when_all_dependencies_healthy(
    async_client, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    app.state.knowledge_base_healthy = True
    app.state.knowledge_base_error = None

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return SimpleNamespace(status_code=200)
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=200)
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["database"] == "healthy"
    assert payload["llama_stack"] == "healthy"
    assert payload["safety_shield"] == "healthy"
    assert payload["knowledge_base"] == "healthy"


@pytest.mark.anyio
async def test_health_full_returns_503_when_circuit_breaker_open(async_client, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", True)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    class FakeBreaker:
        state = SimpleNamespace(value="open")

    monkeypatch.setattr("myloware.api.routes.health._get_circuit_breaker", lambda: FakeBreaker())

    monkeypatch.setattr(app.state, "knowledge_base_healthy", True, raising=False)
    monkeypatch.setattr(app.state, "knowledge_base_error", None, raising=False)

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=200)
            raise AssertionError(f"unexpected url: {url}")

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 503
    payload = resp.json()
    assert payload["llama_stack"] == "circuit_open"
    assert payload["llama_stack_circuit"] == "open"


@pytest.mark.anyio
async def test_health_full_marks_database_unhealthy(async_client, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    monkeypatch.setattr(app.state, "knowledge_base_healthy", True, raising=False)
    monkeypatch.setattr(app.state, "knowledge_base_error", None, raising=False)

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return SimpleNamespace(status_code=200)
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=200)
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        "myloware.storage.database.get_engine",
        lambda: (_ for _ in ()).throw(RuntimeError("db down")),
    )

    resp = await async_client.get("/health/full")
    assert resp.status_code == 503
    payload = resp.json()
    assert payload["database"] == "unhealthy"


@pytest.mark.anyio
async def test_health_full_marks_llama_stack_unhealthy_for_non_200(
    async_client, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    monkeypatch.setattr(app.state, "knowledge_base_healthy", True, raising=False)
    monkeypatch.setattr(app.state, "knowledge_base_error", None, raising=False)

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return SimpleNamespace(status_code=500)
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=200)
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 503
    payload = resp.json()
    assert payload["llama_stack"] == "unhealthy"


@pytest.mark.anyio
async def test_health_full_marks_llama_stack_unreachable_on_exception(
    async_client, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    monkeypatch.setattr(app.state, "knowledge_base_healthy", True, raising=False)
    monkeypatch.setattr(app.state, "knowledge_base_error", None, raising=False)

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                raise RuntimeError("nope")
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=200)
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 503
    payload = resp.json()
    assert payload["llama_stack"] == "unreachable"


@pytest.mark.anyio
async def test_health_full_marks_shield_unhealthy_for_non_200(async_client, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    monkeypatch.setattr(app.state, "knowledge_base_healthy", True, raising=False)
    monkeypatch.setattr(app.state, "knowledge_base_error", None, raising=False)

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return SimpleNamespace(status_code=200)
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=404)
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 503
    payload = resp.json()
    assert payload["safety_shield"] == "unhealthy(404)"


@pytest.mark.anyio
async def test_health_full_marks_shield_unreachable_on_exception(async_client, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    monkeypatch.setattr(app.state, "knowledge_base_healthy", True, raising=False)
    monkeypatch.setattr(app.state, "knowledge_base_error", None, raising=False)

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return SimpleNamespace(status_code=200)
            if "/v1/shields/" in url:
                raise RuntimeError("nope")
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 503
    payload = resp.json()
    assert payload["safety_shield"] == "unreachable"


@pytest.mark.anyio
async def test_health_full_kb_degraded_is_visible_but_does_not_fail(
    async_client, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    monkeypatch.setattr(app.state, "knowledge_base_healthy", False, raising=False)
    monkeypatch.setattr(app.state, "knowledge_base_error", "kb down", raising=False)

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return SimpleNamespace(status_code=200)
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=200)
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["knowledge_base"] == "degraded"
    assert payload["knowledge_base_error"] == "kb down"


@pytest.mark.anyio
async def test_health_full_kb_unknown_when_state_missing(async_client, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    if hasattr(app.state, "knowledge_base_healthy"):
        monkeypatch.delattr(app.state, "knowledge_base_healthy", raising=False)
    if hasattr(app.state, "knowledge_base_error"):
        monkeypatch.delattr(app.state, "knowledge_base_error", raising=False)

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return SimpleNamespace(status_code=200)
            if "/v1/shields/" in url:
                return SimpleNamespace(status_code=200)
            return SimpleNamespace(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await async_client.get("/health/full")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["knowledge_base"] == "unknown"


@pytest.mark.anyio
async def test_health_full_kb_not_checked_without_request_app(monkeypatch) -> None:
    from types import SimpleNamespace as NS

    from myloware.api.routes import health
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return NS(status_code=200)
            if "/v1/shields/" in url:
                return NS(status_code=200)
            return NS(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    resp = await health.full_health_check(NS())
    assert resp.status_code == 200
    assert resp.body
    assert b'"knowledge_base":"not_checked"' in resp.body


@pytest.mark.anyio
async def test_health_full_kb_check_failed_on_state_error(monkeypatch) -> None:
    from types import SimpleNamespace as NS

    from myloware.api.routes import health
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "llama_stack_provider", "real")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "upload_post_provider", "real")
    monkeypatch.setattr(settings, "circuit_breaker_enabled", False)
    monkeypatch.setattr(settings, "content_safety_shield_id", "shield-1")

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, _stmt):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr("myloware.storage.database.get_engine", lambda: FakeEngine())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            if url.endswith("/health"):
                return NS(status_code=200)
            if "/v1/shields/" in url:
                return NS(status_code=200)
            return NS(status_code=404)

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    class BadApp:
        @property
        def state(self):
            raise RuntimeError("boom")

    class BadRequest:
        app = BadApp()

    resp = await health.full_health_check(BadRequest())
    assert resp.status_code == 200
    assert resp.body
    assert b'"knowledge_base":"check_failed"' in resp.body
