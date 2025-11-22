from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from apps.api.config import settings
from apps.api.deps import get_video_gen_service
from apps.api.main import app


class FakeVideoGenService:
    def __init__(self) -> None:
        self.run_input: dict[str, str] | None = None
        self._artifact_id = UUID("00000000-0000-0000-0000-000000000123")

    def start_run(self, *, project: str, run_input: dict[str, str], options: dict | None = None) -> dict[str, str]:
        self.run_input = {"project": project, **run_input, "options": options or {}}
        return {"run_id": "run-123", "status": "pending"}

    def get_run(self, run_id: str) -> dict[str, str]:
        return {
            "run_id": run_id,
            "project": "test_video_gen",
            "status": "published",
            "result": {"publishUrl": "https://tiktok.example/video"},
        }

    def list_artifacts(self, run_id: str) -> list[dict]:
        return [
            {
                "id": self._artifact_id,
                "type": "publish.url",
                "url": "https://tiktok.example/video",
                "provider": "upload-post",
                "checksum": None,
                "metadata": {"canonicalUrl": "https://tiktok.example/video"},
                "created_at": datetime.now(UTC),
            }
        ]


@pytest.fixture()
def override_service() -> Iterator[FakeVideoGenService]:
    fake = FakeVideoGenService()
    app.dependency_overrides[get_video_gen_service] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_video_gen_service, None)


@pytest.mark.asyncio
async def test_start_run_returns_run_id(override_service: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/runs/start",
            json={"project": "test_video_gen", "input": {"title": "test"}},
            headers={"x-api-key": settings.api_key},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["runId"] == "run-123"
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_get_run_returns_publish_url(override_service: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1/runs/run-123", headers={"x-api-key": settings.api_key})
    assert response.status_code == 200
    data = response.json()
    assert data["result"]["publishUrl"] == "https://tiktok.example/video"
    assert len(data["artifacts"]) == 1
    assert data["artifacts"][0]["type"] == "publish.url"


@pytest.mark.asyncio
async def test_runs_require_api_key(override_service: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/runs/start",
            json={"project": "test_video_gen", "input": {"title": "test"}},
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_start_run_accepts_object_without_prompt(override_service: FakeVideoGenService) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/runs/start",
            json={"project": "aismr", "input": {"object": "candles"}},
            headers={"x-api-key": settings.api_key},
        )
    assert response.status_code == 200
    assert override_service.run_input is not None
    assert override_service.run_input.get("object") == "candles"
