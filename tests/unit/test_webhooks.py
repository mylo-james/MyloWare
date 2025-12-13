"""Tests for external service webhooks."""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api.server import app
    from api.routes import webhooks

    app.dependency_overrides[webhooks.get_async_run_repo] = lambda: DummyAsyncRunRepo()
    app.dependency_overrides[webhooks.get_async_artifact_repo] = lambda: DummyAsyncArtifactRepo()

    return TestClient(app)


@contextmanager
def _fake_session():
    yield MagicMock()


class DummyAsyncRunRepo:
    def __init__(self):
        class _Session:
            async def commit(self): ...

        self.session = _Session()
        self._status = "awaiting_render"

    async def create_async(self, *_args, **_kwargs):
        # Used by async startup paths; return a dummy run object
        run = MagicMock()
        run.id = _kwargs.get("id") if _kwargs else None
        return run

    async def get_async(self, *_args, **_kwargs):
        run = MagicMock()
        run.status = self._status
        run.id = _args[0] if _args else None
        run.artifacts = {}
        return run

    async def get_for_update_async(self, *_args, **_kwargs):
        run = MagicMock()
        run.status = "awaiting_video_generation"
        return run

    async def update_async(self, *_args, **_kwargs):
        return None

    def update(self, *_args, **_kwargs):
        return None

    async def add_artifact_async(self, *_args, **_kwargs):
        return None


class DummyAsyncArtifactRepo:
    async def create_async(self, *_args, **_kwargs):
        return None

    async def get_by_run_async(self, *_args, **_kwargs):
        return []

    def create(self, *_args, **_kwargs):
        return None

    def get_by_run(self, *_args, **_kwargs):
        return []


class TestSoraWebhook:
    """Tests for Sora video generation webhook."""

    def test_valid_sora_callback(self, client):
        run_id = "00000000-0000-0000-0000-000000000123"
        with (
            patch("api.routes.webhooks.get_session", _fake_session, create=True),
            patch("api.routes.webhooks.get_async_run_repo", lambda: DummyAsyncRunRepo()),
            patch("api.routes.webhooks.get_async_artifact_repo", lambda: DummyAsyncArtifactRepo()),
            patch("api.routes.webhooks.settings") as mock_settings,
        ):
            mock_settings.sora_provider = "fake"
            mock_settings.openai_sora_signing_secret = ""
            mock_settings.openai_standard_webhook_secret = ""
            mock_settings.disable_background_workflows = True

            response = client.post(
                f"/v1/webhooks/sora?run_id={run_id}",
                json={
                    "code": 200,
                    "msg": "success",
                    "data": {
                        "taskId": "task-abc",
                        "info": {"resultUrls": ["https://cdn.openai sora/video.mp4"]},
                    },
                    "metadata": {"videoIndex": 0},
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "accepted"
            assert data["run_id"] == run_id

    def test_sora_missing_run_id(self, client):
        with patch("api.routes.webhooks.settings") as mock_settings:
            mock_settings.sora_signing_secret = ""

            response = client.post(
                "/v1/webhooks/sora",
                json={
                    "code": 200,
                    "data": {"taskId": "task-abc"},
                },
            )

            assert response.status_code == 400

    def test_sora_invalid_json(self, client):
        with patch("api.routes.webhooks.settings") as mock_settings:
            mock_settings.sora_signing_secret = ""

            response = client.post(
                "/v1/webhooks/sora?run_id=00000000-0000-0000-0000-000000000123",
                content="not json",
                headers={"Content-Type": "application/json"},
            )

            assert response.status_code == 400


class TestRemotionWebhook:
    """Tests for Remotion render webhook."""

    def test_valid_remotion_callback(self, client):
        run_id = "00000000-0000-0000-0000-000000000999"
        with (
            patch("api.routes.webhooks.get_session", _fake_session, create=True),
            patch("api.routes.webhooks.get_async_run_repo", lambda: DummyAsyncRunRepo()),
            patch("api.routes.webhooks.get_async_artifact_repo", lambda: DummyAsyncArtifactRepo()),
            patch("api.routes.webhooks.settings") as mock_settings,
        ):
            mock_settings.remotion_webhook_secret = ""
            mock_settings.remotion_provider = "fake"
            mock_settings.disable_background_workflows = True

            response = client.post(
                f"/v1/webhooks/remotion?run_id={run_id}",
                json={
                    "job_id": "job-1",
                    "status": "done",
                    "output_url": "https://render.local/output/job-1.mp4",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "accepted"
            assert data["run_id"] == run_id

    def test_remotion_missing_run_id(self, client):
        with patch("api.routes.webhooks.settings") as mock_settings:
            mock_settings.remotion_webhook_secret = ""

            response = client.post(
                "/v1/webhooks/remotion",
                json={"job_id": "job-2", "status": "done", "output_url": "https://render"},
            )

            assert response.status_code == 400
