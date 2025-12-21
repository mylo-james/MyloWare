"""Unit tests for FastAPI server endpoints."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from myloware.api.dependencies import (
    get_artifact_repo,
    get_async_llama_client,
    get_llama_client,
    get_run_repo,
    get_vector_db_id,
)
from myloware.api.dependencies_async import get_async_run_repo
from myloware.api.server import app
from myloware.config import settings
from myloware.storage.models import RunStatus


class FakeRunRepo:
    def __init__(self, run, recent_count: int = 0):
        self._run = run
        self._recent_count = recent_count

        class _Session:
            async def commit(self): ...

        self.session = _Session()

    async def create_async(self, **kwargs):
        return self._run

    def get(self, run_id):
        return self._run if run_id == self._run.id else None

    async def get_async(self, run_id):
        return self.get(run_id)

    async def count_runs_since_async(self, _dt):  # type: ignore[no-untyped-def]
        return self._recent_count

    def create(self, **kwargs):
        return self._run


class FakeArtifactRepo:  # pragma: no cover - placeholder
    pass


@pytest.fixture
def fake_run():
    return SimpleNamespace(
        id=uuid.uuid4(),
        workflow_name="aismr",
        status=RunStatus.RUNNING.value,
        current_step="ideator",
        artifacts={"ideas": "do things"},
        error=None,
    )


@pytest.fixture
def api_client(monkeypatch, fake_run):
    fake_run_repo = FakeRunRepo(fake_run)
    fake_artifacts = FakeArtifactRepo()

    # Dependency overrides
    app.dependency_overrides[get_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_artifact_repo] = lambda: fake_artifacts
    app.dependency_overrides[get_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    # run_workflow_async is called in background, just make it a no-op
    monkeypatch.setattr(
        "myloware.api.routes.runs.run_workflow_async",
        lambda **_kwargs: None,
    )

    with TestClient(app) as client:
        yield client

    app.dependency_overrides = {}


def test_health_is_public():
    """Health endpoint is public for Docker health checks."""
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_start_run(api_client):
    settings.skip_run_visibility_check = True
    payload = {"brief": "make video", "workflow": "aismr"}
    resp = api_client.post("/v1/runs/start", json=payload, headers={"X-API-Key": settings.api_key})

    assert resp.status_code == 200
    body = resp.json()
    assert "run_id" in body
    # Now returns "pending" since workflow runs in background
    assert body["status"] == "pending"


def test_get_run(api_client, fake_run):
    resp = api_client.get(f"/v1/runs/{fake_run.id}", headers={"X-API-Key": settings.api_key})

    assert resp.status_code == 200
    data = resp.json()
    assert data["run_id"] == str(fake_run.id)
    assert data["status"] == fake_run.status
    assert data["artifacts"]["ideas"] == "do things"


def test_start_run_budget_exceeded(monkeypatch, fake_run):
    from myloware.api.server import app

    fake_run_repo = FakeRunRepo(fake_run, recent_count=1)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "max_runs_last_24h", 1)
    monkeypatch.setattr(settings, "enable_safety_shields", False)
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 429

    app.dependency_overrides = {}


def test_start_run_daily_cost_budget_exceeded(monkeypatch, fake_run):
    from myloware.api.server import app

    fake_run_repo = FakeRunRepo(fake_run, recent_count=0)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "max_runs_last_24h", 0)
    monkeypatch.setattr(settings, "daily_cost_budget_usd", 0.1)
    monkeypatch.setattr(settings, "estimated_cost_per_run_usd", 1.0)
    monkeypatch.setattr(settings, "enable_safety_shields", False)
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 429

    app.dependency_overrides = {}


def test_start_run_safety_rejects(monkeypatch, fake_run):
    from myloware.api.server import app
    from myloware.api.routes import runs as runs_mod

    fake_run_repo = FakeRunRepo(fake_run)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)

    async def fake_check(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(safe=False, reason="nope", category="policy")

    monkeypatch.setattr(runs_mod, "check_brief_safety", fake_check)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 400

    app.dependency_overrides = {}


def test_start_run_visibility_check_failure(monkeypatch, fake_run):
    from myloware.api.server import app
    from myloware.api.routes import runs as runs_mod

    fake_run_repo = FakeRunRepo(fake_run)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "enable_safety_shields", False)
    monkeypatch.setattr(settings, "skip_run_visibility_check", False)

    async def no_sleep(*_a, **_k):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(runs_mod.asyncio, "sleep", no_sleep)

    class FakeVerifyRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
            return None

    class FakeSession:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSession())
    )
    monkeypatch.setattr("myloware.storage.repositories.RunRepository", FakeVerifyRepo)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 500

    app.dependency_overrides = {}


def test_start_run_enqueues_job(monkeypatch, fake_run):
    from myloware.api.server import app
    from myloware.api.routes import runs as runs_mod

    fake_run_repo = FakeRunRepo(fake_run)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)
    monkeypatch.setattr(settings, "enable_safety_shields", False)

    class FakeJobRepo:
        async def enqueue_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(runs_mod, "JobRepository", lambda _s: FakeJobRepo())

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 200

    app.dependency_overrides = {}


def test_start_run_enqueue_value_error_ignored(monkeypatch, fake_run):
    from myloware.api.server import app
    from myloware.api.routes import runs as runs_mod

    fake_run_repo = FakeRunRepo(fake_run)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)
    monkeypatch.setattr(settings, "enable_safety_shields", False)

    class FakeJobRepo:
        async def enqueue_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            raise ValueError("duplicate")

    monkeypatch.setattr(runs_mod, "JobRepository", lambda _s: FakeJobRepo())

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 200

    app.dependency_overrides = {}


def test_start_run_in_process_adds_task(monkeypatch, fake_run):
    from myloware.api.server import app
    from myloware.api.routes import runs as runs_mod

    fake_run_repo = FakeRunRepo(fake_run)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)
    monkeypatch.setattr(settings, "enable_safety_shields", False)

    monkeypatch.setattr(runs_mod, "run_workflow_async", lambda **_k: None)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 200

    app.dependency_overrides = {}


def test_start_run_visibility_check_passes(monkeypatch, fake_run):
    from myloware.api.server import app

    fake_run_repo = FakeRunRepo(fake_run)
    app.dependency_overrides[get_async_run_repo] = lambda: fake_run_repo
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "enable_safety_shields", False)
    monkeypatch.setattr(settings, "skip_run_visibility_check", False)

    class FakeVerifyRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
            return object()

    class FakeSession:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSession())
    )
    monkeypatch.setattr("myloware.storage.repositories.RunRepository", FakeVerifyRepo)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 200

    app.dependency_overrides = {}


def test_start_run_create_async_file_not_found(monkeypatch, fake_run):
    from myloware.api.server import app

    class ErrorRunRepo(FakeRunRepo):
        async def create_async(self, **_kwargs):
            raise FileNotFoundError("missing")

    app.dependency_overrides[get_async_run_repo] = lambda: ErrorRunRepo(fake_run)
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "enable_safety_shields", False)
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 404

    app.dependency_overrides = {}


def test_start_run_create_async_value_error(monkeypatch, fake_run):
    from myloware.api.server import app

    class ErrorRunRepo(FakeRunRepo):
        async def create_async(self, **_kwargs):
            raise ValueError("bad")

    app.dependency_overrides[get_async_run_repo] = lambda: ErrorRunRepo(fake_run)
    app.dependency_overrides[get_async_llama_client] = lambda: object()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    monkeypatch.setattr(settings, "enable_safety_shields", False)
    monkeypatch.setattr(settings, "skip_run_visibility_check", True)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/runs/start",
            json={"brief": "make video", "workflow": "aismr"},
            headers={"X-API-Key": settings.api_key},
        )
        assert resp.status_code == 400

    app.dependency_overrides = {}


def test_get_run_not_found(monkeypatch, fake_run):
    from myloware.api.server import app

    class MissingRunRepo(FakeRunRepo):
        async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
            return None

    app.dependency_overrides[get_async_run_repo] = lambda: MissingRunRepo(fake_run)

    with TestClient(app) as client:
        resp = client.get(f"/v1/runs/{uuid.uuid4()}", headers={"X-API-Key": settings.api_key})
        assert resp.status_code == 404

    app.dependency_overrides = {}
