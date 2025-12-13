"""Unit tests for FastAPI server endpoints."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api.dependencies import (
    get_artifact_repo,
    get_llama_client,
    get_run_repo,
    get_vector_db_id,
)
from api.dependencies_async import get_async_run_repo
from api.server import app
from config import settings
from storage.models import RunStatus


class FakeRunRepo:
    def __init__(self, run):
        self._run = run

        class _Session:
            async def commit(self): ...

        self.session = _Session()

    async def create_async(self, **kwargs):
        return self._run

    def get(self, run_id):
        return self._run if run_id == self._run.id else None

    async def get_async(self, run_id):
        return self.get(run_id)

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
        "api.routes.runs.run_workflow_async",
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
