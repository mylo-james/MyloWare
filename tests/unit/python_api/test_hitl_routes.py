from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from apps.api.config import settings
from apps.api.main import app
from apps.api.deps import get_database, get_orchestrator_client
from apps.api.routes.hitl import generate_approval_token
from apps.api import rate_limiter


class FakeDB:
    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.approvals: list[dict] = []
        self.artifacts: list[dict[str, Any]] = []

    def get_run(self, run_id: str) -> dict | None:  # type: ignore[override]
        return self.runs.get(run_id)

    def record_hitl_approval(  # type: ignore[override]
        self,
        *,
        run_id: str,
        gate: str,
        approver_ip: str | None = None,
        approver: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        record = {
            "run_id": run_id,
            "gate": gate,
            "ip": approver_ip,
            "approver": approver,
            "metadata": metadata or {},
        }
        self.approvals.append(record)

    def update_run(self, *, run_id: str, status: str, result: dict | None = None) -> None:  # type: ignore[override]
        run = self.runs.setdefault(run_id, {})
        run["status"] = status
        if result is not None:
            run["result"] = result

    def create_artifact(
        self,
        *,
        run_id: str,
        artifact_type: str,
        url: str | None,
        provider: str,
        checksum: str | None,
        metadata: dict[str, Any],
        persona: str | None = None,
    ) -> None:  # type: ignore[override]
        self.artifacts.append(
            {
                "run_id": run_id,
                "type": artifact_type,
                "provider": provider,
                "metadata": metadata,
                "persona": persona,
            }
        )


class FakeOrchestrator:
    def __init__(self) -> None:
        self.invocations: list[tuple[str, dict]] = []
        self.raise_exc: Exception | None = None

    def invoke(self, run_id: str, payload: dict, background: bool = True) -> dict:  # noqa: D401
        if self.raise_exc:
            raise self.raise_exc
        self.invocations.append((run_id, payload))
        return {"run_id": run_id, "status": "started"}


ClientFixture = tuple[TestClient, FakeDB, FakeOrchestrator]


@pytest.fixture()
def client() -> Iterator[ClientFixture]:
    fake_db = FakeDB()
    fake_orchestrator = FakeOrchestrator()
    app.dependency_overrides[get_database] = lambda: fake_db
    app.dependency_overrides[get_orchestrator_client] = lambda: fake_orchestrator
    test_client = TestClient(app)
    yield test_client, fake_db, fake_orchestrator
    app.dependency_overrides.pop(get_database, None)
    app.dependency_overrides.pop(get_orchestrator_client, None)


def test_get_approval_link_returns_signed_url(client: ClientFixture) -> None:
    test_client, fake_db, _ = client
    fake_db.runs["run-link"] = {"run_id": "run-link", "project": "test_video_gen"}

    response = test_client.get(
        "/v1/hitl/link/run-link/ideate",
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["runId"] == "run-link"
    assert payload["gate"] == "ideate"
    assert payload["token"]
    assert payload["approvalUrl"].startswith("http")
    assert "token=" in payload["approvalUrl"]


def test_approve_gate_records_artifact_and_resumes(client: ClientFixture) -> None:
    test_client, fake_db, fake_orchestrator = client
    fake_db.runs["run-approve"] = {"run_id": "run-approve", "project": "aismr"}

    token = generate_approval_token("run-approve", "ideate")

    response = test_client.get(
        f"/v1/hitl/approve/run-approve/ideate?token={token}",
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["gate"] == "ideate"
    assert payload["runId"] == "run-approve"

    assert fake_db.approvals
    approval = fake_db.approvals[0]
    assert approval["run_id"] == "run-approve"
    assert approval["gate"] == "ideate"

    assert fake_orchestrator.invocations
    invoked_run, orchestrator_payload = fake_orchestrator.invocations[0]
    assert invoked_run == "run-approve"
    assert orchestrator_payload["resume"]["gate"] == "ideate"
    assert orchestrator_payload["resume"]["approved"] is True




def test_approve_gate_surfaces_orchestrator_http_error(
    client: ClientFixture,
    caplog: pytest.LogCaptureFixture,
) -> None:
    test_client, fake_db, fake_orchestrator = client
    fake_db.runs["run-err"] = {"run_id": "run-err", "project": "aismr"}
    fake_orchestrator.raise_exc = httpx.HTTPError("boom")

    token = generate_approval_token("run-err", "ideate")
    with caplog.at_level("ERROR", logger="myloware.api.hitl"):
        response = test_client.get(
            f"/v1/hitl/approve/run-err/ideate?token={token}",
            headers={"x-api-key": settings.api_key},
        )

    assert response.status_code == 502
    assert response.json()["detail"] == "failed to resume run"
    assert any(getattr(record, "run_id", None) == "run-err" for record in caplog.records)
    assert any(getattr(record, "gate", None) == "ideate" for record in caplog.records)




def test_approval_requires_existing_run(client: ClientFixture) -> None:
    test_client, _, _ = client

    token = generate_approval_token("missing", "ideate")
    response = test_client.get(
        f"/v1/hitl/approve/missing/ideate?token={token}",
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 404


def test_invalid_token_is_rejected(client: ClientFixture) -> None:
    test_client, fake_db, _ = client
    fake_db.runs["run-invalid"] = {"run_id": "run-invalid", "project": "test_video_gen"}

    response = test_client.get(
        "/v1/hitl/approve/run-invalid/ideate?token=bad-token",
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "invalid or expired token"


def test_expired_token_is_rejected(monkeypatch: pytest.MonkeyPatch, client: ClientFixture) -> None:
    import apps.api.routes.hitl as hitl_module

    test_client, fake_db, _ = client
    fake_db.runs["run-expired"] = {"run_id": "run-expired", "project": "test_video_gen"}

    base_time = 1_700_000_000
    monkeypatch.setattr(hitl_module.time, "time", lambda: base_time)
    token = generate_approval_token("run-expired", "ideate")
    future_time = base_time + (hitl_module.HITL_TOKEN_EXPIRY_HOURS * 3600) + 1
    monkeypatch.setattr(hitl_module.time, "time", lambda: future_time)

    response = test_client.get(
        f"/v1/hitl/approve/run-expired/ideate?token={token}",
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "invalid or expired token"


def test_request_ip_is_recorded(client: ClientFixture) -> None:
    test_client, fake_db, _ = client
    fake_db.runs["run-ip"] = {"run_id": "run-ip", "project": "test_video_gen"}

    token = generate_approval_token("run-ip", "ideate")
    response = test_client.get(
        f"/v1/hitl/approve/run-ip/ideate?token={token}",
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 200
    assert fake_db.approvals


def test_approve_gate_renders_html_page(client: ClientFixture) -> None:
    test_client, fake_db, _ = client
    fake_db.runs["run-ui"] = {"run_id": "run-ui", "project": "test_video_gen"}

    token = generate_approval_token("run-ui", "ideate")
    response = test_client.get(
        f"/v1/hitl/approve/run-ui/ideate?token={token}",
        headers={"x-api-key": settings.api_key, "accept": "text/html"},
    )

    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    assert "text/html" in content_type
    body = response.text
    assert "run-ui" in body
    assert "ideate" in body
    assert fake_db.approvals
    assert fake_db.approvals[0]["ip"] in {"testclient", "127.0.0.1"}


def test_prepublish_gate_resumes_pipeline(client: ClientFixture) -> None:
    test_client, fake_db, fake_orchestrator = client
    fake_db.runs["run-pre"] = {"run_id": "run-pre", "project": "test_video_gen"}

    token = generate_approval_token("run-pre", "prepublish")
    response = test_client.get(
        f"/v1/hitl/approve/run-pre/prepublish?token={token}",
        headers={"x-api-key": settings.api_key},
    )

    assert response.status_code == 200
    invoked_run, payload = fake_orchestrator.invocations[-1]
    assert invoked_run == "run-pre"
    assert payload["resume"]["gate"] == "prepublish"


def test_duplicate_approvals_are_allowed_but_recorded(client: ClientFixture) -> None:
    test_client, fake_db, fake_orchestrator = client
    fake_db.runs["run-dup"] = {"run_id": "run-dup", "project": "test_video_gen"}

    token = generate_approval_token("run-dup", "ideate")
    for _ in range(2):
        resp = test_client.get(
            f"/v1/hitl/approve/run-dup/ideate?token={token}",
            headers={"x-api-key": settings.api_key},
        )
        assert resp.status_code == 200

    assert len(fake_db.approvals) == 2
    assert len(fake_orchestrator.invocations) == 2


def test_hitl_rate_limit_enforced(
    client: ClientFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_client, fake_db, _ = client
    fake_db.runs["run-limit"] = {"run_id": "run-limit", "project": "aismr"}
    limiter = rate_limiter.get_rate_limiter()
    limiter.reset()
    monkeypatch.setitem(
        rate_limiter.RATE_LIMITS,
        "hitl_approve",
        rate_limiter.RateLimitConfig(limit=1, window_seconds=60),
    )
    token = generate_approval_token("run-limit", "ideate")
    ok_response = test_client.get(
        f"/v1/hitl/approve/run-limit/ideate?token={token}",
        headers={"x-api-key": settings.api_key},
    )
    assert ok_response.status_code == 200
    second = test_client.get(
        f"/v1/hitl/approve/run-limit/ideate?token={token}",
        headers={"x-api-key": settings.api_key},
    )
    assert second.status_code == 429
    assert second.json()["detail"] == "rate limit exceeded"
    assert "Retry-After" in second.headers
