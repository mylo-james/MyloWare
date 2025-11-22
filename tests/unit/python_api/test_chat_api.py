from __future__ import annotations

from collections.abc import Iterator

import pytest
from httpx import ASGITransport, AsyncClient

from apps.api.config import settings
from apps.api.deps import get_orchestrator_client
from apps.api.main import app
from apps.api import rate_limiter


class FakeOrchestratorClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def chat_brendan(self, *, user_id: str, message: str) -> dict[str, object]:
        self.calls.append((user_id, message))
        return {
            "response": f"Echo: {message}",
            "run_ids": ["run-001"],
            "citations": [{"path": "docs/aismr.md", "reason": "example"}],
        }


@pytest.fixture()
def fake_orchestrator() -> Iterator[FakeOrchestratorClient]:
    fake = FakeOrchestratorClient()
    app.dependency_overrides[get_orchestrator_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_orchestrator_client, None)


@pytest.mark.asyncio
async def test_chat_proxy_forwards_payload(fake_orchestrator: FakeOrchestratorClient) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-123", "message": "Hello"},
            headers={"x-api-key": settings.api_key},
        )
    assert response.status_code == 200
    assert fake_orchestrator.calls == [("user-123", "Hello")]
    data = response.json()
    assert data == {
        "response": "Echo: Hello",
        "run_ids": ["run-001"],
        "citations": [{"path": "docs/aismr.md", "reason": "example"}],
    }


@pytest.mark.asyncio
async def test_chat_requires_api_key(fake_orchestrator: FakeOrchestratorClient) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-123", "message": "Hello"},
        )
    assert response.status_code == 401
    assert fake_orchestrator.calls == []


@pytest.mark.asyncio
async def test_chat_rate_limit_returns_429(
    fake_orchestrator: FakeOrchestratorClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    limiter = rate_limiter.get_rate_limiter()
    limiter.reset()
    monkeypatch.setitem(
        rate_limiter.RATE_LIMITS,
        "chat_brendan",
        rate_limiter.RateLimitConfig(limit=1, window_seconds=60),
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-123", "message": "Hello"},
            headers={"x-api-key": settings.api_key},
        )
        assert first.status_code == 200
        second = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-123", "message": "Again"},
            headers={"x-api-key": settings.api_key},
        )
    assert second.status_code == 429
    assert second.json()["detail"] == "rate limit exceeded"


@pytest.mark.asyncio
async def test_chat_rate_limit_sets_retry_after_header(
    fake_orchestrator: FakeOrchestratorClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    limiter = rate_limiter.get_rate_limiter()
    limiter.reset()
    monkeypatch.setitem(
        rate_limiter.RATE_LIMITS,
        "chat_brendan",
        rate_limiter.RateLimitConfig(limit=1, window_seconds=60),
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-123", "message": "Hello"},
            headers={"x-api-key": settings.api_key},
        )
        assert first.status_code == 200
        second = await client.post(
            "/v1/chat/brendan",
            json={"user_id": "user-123", "message": "Again"},
            headers={"x-api-key": settings.api_key},
        )
    assert second.status_code == 429
    assert "Retry-After" in second.headers
