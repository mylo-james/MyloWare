from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
import httpx

from apps.api.main import app
from apps.api import rate_limiter
from apps.api.config import settings
from apps.api.deps import get_video_gen_service


class FakeOrchestrator:
    def __init__(self) -> None:
        self.invocations: list[tuple[str, dict[str, Any]]] = []
        self.should_raise = False

    def invoke(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.should_raise:
            raise httpx.HTTPError("invoke failed")
        self.invocations.append((run_id, payload))
        return {"state": {"status": "resumed"}}


class FakeVideoGenService:
    def __init__(self) -> None:
        self.start_calls: list[dict[str, Any]] = []
        self.runs: dict[str, dict[str, Any]] = {}
        self.artifacts: dict[str, list[dict[str, Any]]] = {}
        self._orchestrator = FakeOrchestrator()
        self.cancel_calls: list[dict[str, Any]] = []

    def start_run(self, *, project: str, run_input: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
        self.start_calls.append({"project": project, "run_input": run_input, "options": options})
        run_id = "run-start"
        return {"run_id": run_id, "status": "pending"}

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        return self.runs.get(run_id)

    def list_artifacts(self, run_id: str) -> list[dict[str, Any]]:
        return self.artifacts.get(run_id, [])

    def cancel_run(self, run_id: str, *, reason: str | None = None, actor: str | None = None) -> dict[str, Any]:
        self.cancel_calls.append({"run_id": run_id, "reason": reason, "actor": actor})
        record = self.runs.get(run_id)
        if not record:
            raise ValueError("run not found")
        status = record.get("status", "pending")
        if status in {"published", "failed", "cancelled"}:
            raise RuntimeError("run already completed")
        record["status"] = "cancelled"
        return {"run_id": run_id, "status": "cancelled"}


@pytest.fixture()
def client() -> Iterator[tuple[TestClient, FakeVideoGenService]]:
    service = FakeVideoGenService()
    app.dependency_overrides[get_video_gen_service] = lambda: service
    test_client = TestClient(app)
    yield test_client, service
    app.dependency_overrides.pop(get_video_gen_service, None)


def test_start_run_invokes_service(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, service = client
    payload = {
        "project": "test_video_gen",
        "input": {"prompt": "Hello world"},
        "options": {"priority": "low"},
    }
    response = test_client.post("/v1/runs/start", json=payload, headers={"x-api-key": settings.api_key})
    assert response.status_code == 200
    data = response.json()
    assert data["runId"] == "run-start"
    assert data["status"] == "pending"
    assert service.start_calls[0]["run_input"] == {"prompt": "Hello world"}


def test_get_run_returns_artifacts(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, service = client
    run = {
        "run_id": "run-123",
        "project": "aismr",
        "status": "published",
        "result": '{"videos":[{"subject":"moon","header":"cheeseburger"}]}',
    }
    service.runs["run-123"] = run
    service.artifacts["run-123"] = [
        {
            "id": "8f3cc884-4d55-4a83-94c3-152a6dfe5f30",
            "type": "kieai.job",
            "url": "https://clips/video.mp4",
            "provider": "kieai",
            "metadata": '{"taskId":"job-1"}',
            "created_at": datetime.now().isoformat(),
        }
    ]

    response = test_client.get("/v1/runs/run-123", headers={"x-api-key": settings.api_key})
    assert response.status_code == 200
    data = response.json()
    assert data["runId"] == "run-123"
    assert data["project"] == "aismr"
    assert len(data["artifacts"]) == 1
    assert data["artifacts"][0]["metadata"]["taskId"] == "job-1"


def test_get_run_missing_returns_404(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, _ = client
    response = test_client.get("/v1/runs/missing", headers={"x-api-key": settings.api_key})
    assert response.status_code == 404


def test_continue_run_invokes_orchestrator(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, service = client
    service.runs["resume-run"] = {
        "run_id": "resume-run",
        "project": "test_video_gen",
        "result": '{"videos":[{"subject":"moon","header":"cheeseburger"}]}',
    }

    response = test_client.post(
        "/v1/runs/resume-run/continue",
        json={"input": "resume", "metadata": {"gate": "ideate"}, "resume": {"approved": True}},
        headers={"x-api-key": settings.api_key},
    )
    assert response.status_code == 200
    payload = service._orchestrator.invocations[0][1]
    assert payload["project"] == "test_video_gen"
    assert payload["videos"] == [{"subject": "moon", "header": "cheeseburger"}]
    assert payload["resume"] == {"approved": True}


def test_continue_run_not_found(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, _ = client
    response = test_client.post(
        "/v1/runs/unknown/continue", json={"input": "resume"}, headers={"x-api-key": settings.api_key}
    )
    assert response.status_code == 404


def test_continue_run_handles_orchestrator_error(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, service = client
    service.runs["error-run"] = {"run_id": "error-run", "project": "test_video_gen", "result": None}
    service._orchestrator.should_raise = True
    response = test_client.post(
        "/v1/runs/error-run/continue", json={"input": "resume"}, headers={"x-api-key": settings.api_key}
    )
    assert response.status_code == 502


def test_continue_run_logs_orchestrator_error_context(
    client: tuple[TestClient, FakeVideoGenService],
    caplog: pytest.LogCaptureFixture,
) -> None:
    test_client, service = client
    service.runs["error-run"] = {"run_id": "error-run", "project": "test_video_gen", "result": None}
    service._orchestrator.should_raise = True
    with caplog.at_level("ERROR", logger="myloware.api.runs"):
        response = test_client.post(
            "/v1/runs/error-run/continue",
            json={"input": "resume"},
            headers={"x-api-key": settings.api_key},
        )
    assert response.status_code == 502
    # Ensure log schema includes run_id and project for error context
    record = caplog.records[-1]
    assert getattr(record, "run_id", None) == "error-run"
    assert getattr(record, "project", None) == "test_video_gen"


def test_start_run_rate_limit_exceeded(
    client: tuple[TestClient, FakeVideoGenService],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_client, _ = client
    limiter = rate_limiter.get_rate_limiter()
    limiter.reset()
    monkeypatch.setitem(
        rate_limiter.RATE_LIMITS,
        "runs_start",
        rate_limiter.RateLimitConfig(limit=2, window_seconds=60),
    )
    payload = {
        "project": "test_video_gen",
        "input": {"prompt": "Hello world"},
        "options": {},
    }
    for _ in range(2):
        resp = test_client.post("/v1/runs/start", json=payload, headers={"x-api-key": settings.api_key})
        assert resp.status_code == 200
    response = test_client.post("/v1/runs/start", json=payload, headers={"x-api-key": settings.api_key})
    assert response.status_code == 429
    assert response.json()["detail"] == "rate limit exceeded"
    assert "Retry-After" in response.headers


def test_continue_run_rate_limit_exceeded(
    client: tuple[TestClient, FakeVideoGenService],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Continuations should also respect rate limits on hot paths."""

    test_client, service = client
    service.runs["resume-run"] = {
        "run_id": "resume-run",
        "project": "test_video_gen",
        "result": '{"videos":[{"subject":"moon","header":"cheeseburger"}]}',
    }

    limiter = rate_limiter.get_rate_limiter()
    limiter.reset()
    monkeypatch.setitem(
        rate_limiter.RATE_LIMITS,
        "runs_continue",
        rate_limiter.RateLimitConfig(limit=1, window_seconds=60),
    )

    payload = {"input": "resume", "metadata": {"gate": "ideate"}}
    first = test_client.post(
        "/v1/runs/resume-run/continue",
        json=payload,
        headers={"x-api-key": settings.api_key},
    )
    assert first.status_code == 200

    second = test_client.post(
        "/v1/runs/resume-run/continue",
        json=payload,
        headers={"x-api-key": settings.api_key},
    )
    assert second.status_code == 429
    assert second.json()["detail"] == "rate limit exceeded"
    assert "Retry-After" in second.headers


def test_cancel_run_updates_status(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, service = client
    service.runs["cancel-me"] = {"run_id": "cancel-me", "status": "pending"}
    response = test_client.post(
        "/v1/runs/cancel-me/cancel",
        json={"reason": "testing", "actor": "qa"},
        headers={"x-api-key": settings.api_key},
    )
    assert response.status_code == 200
    assert response.json() == {"runId": "cancel-me", "status": "cancelled"}
    assert service.cancel_calls[-1] == {"run_id": "cancel-me", "reason": "testing", "actor": "qa"}


def test_cancel_run_missing_returns_404(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, _ = client
    response = test_client.post(
        "/v1/runs/missing/cancel",
        json={"reason": "noop"},
        headers={"x-api-key": settings.api_key},
    )
    assert response.status_code == 404


def test_cancel_run_conflict_returns_409(client: tuple[TestClient, FakeVideoGenService]) -> None:
    test_client, service = client
    service.runs["done"] = {"run_id": "done", "status": "published"}
    response = test_client.post(
        "/v1/runs/done/cancel",
        json={"reason": "late"},
        headers={"x-api-key": settings.api_key},
    )
    assert response.status_code == 409
