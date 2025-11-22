from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.config import Settings
from apps.api.main import app
from apps.api.deps import get_database, get_video_gen_service
from apps.api.services.test_video_gen import VideoGenService
from apps.api import startup as api_startup


class WebhookFakeDB:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.artifacts: list[dict[str, Any]] = []
        self.webhook_events: dict[str, dict[str, Any]] = {}
        self.dlq: list[dict[str, Any]] = []

    def create_artifact(self, **kwargs: Any) -> None:
        self.artifacts.append(kwargs)

    def update_run(self, *, run_id: str, status: str, result: dict[str, Any] | None = None) -> None:
        run = self.runs.setdefault(run_id, {})
        run["status"] = status
        if result is not None:
            run["result"] = result

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        return self.runs.get(run_id)

    def list_artifacts(self, run_id: str) -> list[dict[str, Any]]:
        return [artifact for artifact in self.artifacts if artifact.get("run_id") == run_id]

    def record_webhook_event(
        self,
        *,
        idempotency_key: str,
        provider: str,
        headers: dict[str, str],
        payload: bytes,
        signature_status: str,
    ) -> bool:
        if idempotency_key in self.webhook_events:
            return False
        self.webhook_events[idempotency_key] = {
            "provider": provider,
            "headers": dict(headers),
            "payload": payload,
            "signature_status": signature_status,
        }
        return True

    def record_webhook_dlq(
        self,
        *,
        idempotency_key: str,
        provider: str,
        headers: dict[str, str],
        payload: bytes,
        error: str,
    ) -> None:
        self.dlq.append(
            {
                "idempotency_key": idempotency_key,
                "provider": provider,
                "headers": dict(headers),
                "payload": payload,
                "error": error,
            }
        )


class WebhookFakeKieAI:
    def verify_signature(self, payload: bytes, signature: str | None) -> bool:  # noqa: D401
        return signature == "deadbeef"


class WebhookFakeUploadPost:
    def publish(self, *, video_path: Path, caption: str, account_id: str | None = None, **_: Any) -> dict[str, Any]:  # noqa: D401
        return {"canonicalUrl": "https://upload.example/video"}

    def verify_signature(self, payload: bytes, signature: str | None) -> bool:  # noqa: D401
        return signature == "deadbeef"


class WebhookFakeOrchestrator:
    def invoke(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:  # noqa: D401
        return {"run_id": run_id, "state": payload}


def _build_service(db: WebhookFakeDB) -> VideoGenService:
    return VideoGenService(
        db=db,
        kieai=WebhookFakeKieAI(),
        upload_post=WebhookFakeUploadPost(),
        orchestrator=WebhookFakeOrchestrator(),
        webhook_base_url="http://localhost:8080",
        settings=Settings(rag_persona_prompts=False),
    )


def _seed_run(db: WebhookFakeDB, run_id: str) -> None:
    db.runs[run_id] = {
        "run_id": run_id,
        "project": "test_video_gen",
        "status": "pending",
        "payload": {"project_spec": {"specs": {"videoCount": 2}}},
        "result": {
            "totalVideos": 2,
            "videos": [
                {"index": 0, "status": "pending", "subject": "Moon", "header": "Scene 1"},
                {"index": 1, "status": "pending", "subject": "Sun", "header": "Scene 2"},
            ],
        },
    }


@pytest.fixture()
def fake_db() -> WebhookFakeDB:
    return WebhookFakeDB()


@pytest.fixture()
def video_service(fake_db: WebhookFakeDB) -> VideoGenService:
    return _build_service(fake_db)


@pytest.fixture()
def client(fake_db: WebhookFakeDB, video_service: VideoGenService, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    async def _noop(settings: Settings, app=None) -> None:  # type: ignore[override]
        return None

    monkeypatch.setattr(api_startup, "run_preflight_checks", _noop)
    app.dependency_overrides[get_database] = lambda: fake_db
    app.dependency_overrides[get_video_gen_service] = lambda: video_service
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(get_database, None)
    app.dependency_overrides.pop(get_video_gen_service, None)


def _headers(request_id: str = "req-1") -> dict[str, str]:
    return {
        "content-type": "application/json",
        "x-timestamp": str(int(time.time())),
        "x-request-id": request_id,
        "x-signature": "deadbeef",
    }


def _payload(run_id: str, video_index: int = 0) -> dict[str, Any]:
    return {
        "code": 200,
        "data": {
            "runId": run_id,
            "state": "success",
            "videoUrl": "https://kie.ai/asset.mp4",
            "prompt": "demo",
            "metadata": {"videoIndex": video_index, "subject": "Moon", "header": "Neon"},
        },
        "metadata": {"runId": run_id, "videoIndex": video_index, "subject": "Moon", "header": "Neon"},
    }


def test_kieai_webhook_route_updates_run_and_artifacts(client: TestClient, fake_db: WebhookFakeDB) -> None:
    run_id = "run-live"
    _seed_run(fake_db, run_id)

    response = client.post(
        "/v1/webhooks/kieai",
        params={"run_id": run_id},
        json=_payload(run_id),
        headers=_headers(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "generated"
    assert body["videoIndex"] == 0
    run_record = fake_db.get_run(run_id)
    first_video = run_record["result"]["videos"][0]
    assert first_video["status"] == "generated"
    assert first_video["assetUrl"] == "https://kie.ai/asset.mp4"
    event = fake_db.webhook_events["req-1"]
    assert event["signature_status"] == "verified"
    assert any(artifact.get("artifact_type") == "kieai.clip" for artifact in fake_db.artifacts)


def test_kieai_webhook_route_respects_idempotency(client: TestClient, fake_db: WebhookFakeDB) -> None:
    run_id = "run-live"
    _seed_run(fake_db, run_id)
    payload = _payload(run_id)
    headers = _headers()

    first = client.post("/v1/webhooks/kieai", params={"run_id": run_id}, json=payload, headers=headers)
    assert first.status_code == 200
    assert first.json()["status"] == "generated"

    second = client.post("/v1/webhooks/kieai", params={"run_id": run_id}, json=payload, headers=headers)
    assert second.status_code == 200
    assert second.json()["status"] == "duplicate"
    assert len(fake_db.webhook_events) == 1
    clip_artifacts = [artifact for artifact in fake_db.artifacts if artifact.get("artifact_type") == "kieai.clip"]
    assert len(clip_artifacts) == 1
