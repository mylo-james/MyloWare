from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from apps.api.config import settings
from apps.api.main import app
from apps.api.deps import get_database


class FakeDB:
    def __init__(self) -> None:
        self.created: list[dict] = []

    def get_run(self, run_id: str) -> dict[str, str] | None:
        return {"run_id": run_id, "project": "aismr", "status": "pending"}

    def create_artifact(self, **kwargs):  # type: ignore[no-untyped-def]
        self.created.append(kwargs)


@pytest.fixture()
def client() -> Iterator[tuple[TestClient, FakeDB]]:
    fake = FakeDB()
    app.dependency_overrides[get_database] = lambda: fake
    test_client = TestClient(app)
    yield test_client, fake
    app.dependency_overrides.pop(get_database, None)


def test_artifact_requires_auth(client: tuple[TestClient, FakeDB]) -> None:
    test_client, _ = client
    response = test_client.post("/v1/runs/run-123/artifacts", json={"type": "ideation", "metadata": {}})
    assert response.status_code == 401


def test_artifact_persists_record(client: tuple[TestClient, FakeDB]) -> None:
    test_client, fake = client
    response = test_client.post(
        "/v1/runs/run-123/artifacts",
        json={
            "type": "ideation",
            "provider": "orchestrator",
            "metadata": {"items": [1, 2]},
            "persona": "riley",
        },
        headers={"x-api-key": settings.api_key},
    )
    assert response.status_code == 200
    assert fake.created[0]["artifact_type"] == "ideation"
    assert fake.created[0]["metadata"]["items"] == [1, 2]
    assert fake.created[0]["persona"] == "riley"
