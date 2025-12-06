"""Tests for external service webhooks."""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api.server import app

    return TestClient(app)


@contextmanager
def _fake_session():
    yield MagicMock()


class TestKIEWebhook:
    """Tests for KIE video generation webhook."""

    def test_valid_kie_callback(self, client):
        run_id = "00000000-0000-0000-0000-000000000123"
        with (
            patch("api.routes.webhooks.get_session", _fake_session),
            patch("api.routes.webhooks.ArtifactRepository") as mock_repo,
            patch("api.routes.webhooks.RunRepository") as mock_run_repo,
            patch("api.routes.webhooks.settings") as mock_settings,
        ):
            mock_repo.return_value.create = MagicMock()
            mock_repo.return_value.get_by_run = MagicMock(return_value=[])
            mock_run = MagicMock()
            mock_run.status = "awaiting_video_generation"
            mock_run_repo.return_value.get_for_update = MagicMock(return_value=mock_run)
            mock_run_repo.return_value.update = MagicMock()
            mock_settings.kie_signing_secret = ""  # Disable signature verification

            response = client.post(
                f"/v1/webhooks/kieai?run_id={run_id}",
                json={
                    "code": 200,
                    "msg": "success",
                    "data": {
                        "taskId": "task-abc",
                        "info": {"resultUrls": ["https://cdn.kie.ai/video.mp4"]},
                    },
                    "metadata": {"videoIndex": 0},
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "accepted"
            assert data["run_id"] == run_id

    def test_kie_missing_run_id(self, client):
        with patch("api.routes.webhooks.settings") as mock_settings:
            mock_settings.kie_signing_secret = ""
            
            response = client.post(
                "/v1/webhooks/kieai",
                json={
                    "code": 200,
                    "data": {"taskId": "task-abc"},
                },
            )

            assert response.status_code == 400

    def test_kie_invalid_json(self, client):
        with patch("api.routes.webhooks.settings") as mock_settings:
            mock_settings.kie_signing_secret = ""
            
            response = client.post(
                "/v1/webhooks/kieai?run_id=00000000-0000-0000-0000-000000000123",
                content="not json",
                headers={"Content-Type": "application/json"},
            )

            assert response.status_code == 400


class TestRemotionWebhook:
    """Tests for Remotion render webhook."""

    def test_valid_remotion_callback(self, client):
        run_id = "00000000-0000-0000-0000-000000000999"
        with (
            patch("api.routes.webhooks.get_session", _fake_session),
            patch("api.routes.webhooks.ArtifactRepository") as mock_repo,
            patch("api.routes.webhooks.settings") as mock_settings,
        ):
            mock_repo.return_value.create = MagicMock()
            mock_settings.remotion_webhook_secret = ""

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
