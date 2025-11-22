from __future__ import annotations

from pathlib import Path

import pytest

from adapters.persistence.cache.response_cache import ResponseCache
import adapters.persistence.cache.redis as redis_helpers


def test_response_cache_round_trip(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path / "cache")
    key = {"prompt": "demo", "project": "aismr", "persona": "iggy"}
    value = {"result": "ok", "meta": {"video": 1}}

    assert cache.get("shotstack", key) is None

    cache.set("shotstack", key, value)
    cached = cache.get("shotstack", key)

    assert cached == value

    updated = {"result": "updated"}
    cache.set("shotstack", key, updated)
    assert cache.get("shotstack", key) == updated


def test_response_cache_creates_namespaced_files(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path / "cache")
    cache.set("k1", {"prompt": "a"}, {"value": 1})
    cache.set("k2", {"prompt": "b"}, {"value": 2})

    files = list((tmp_path / "cache").rglob("*.json"))
    assert len(files) == 2
    assert any("k1" in str(path) for path in files)
    assert any("k2" in str(path) for path in files)


def test_redis_get_async_client_handles_availability(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeRedis:
        def __init__(self) -> None:
            self.called_with: list[str] = []

        def from_url(self, url: str):
            self.called_with.append(url)
            return {"url": url}

    fake = FakeRedis()
    monkeypatch.setattr(redis_helpers, "REDIS_AVAILABLE", True, raising=False)
    monkeypatch.setattr(redis_helpers, "redis", fake, raising=False)

    client = redis_helpers.get_async_client("redis://localhost:6379/0")
    assert client == {"url": "redis://localhost:6379/0"}
    assert fake.called_with == ["redis://localhost:6379/0"]

    monkeypatch.setattr(redis_helpers, "REDIS_AVAILABLE", False, raising=False)
    with pytest.raises(RuntimeError):
        redis_helpers.get_async_client("redis://localhost:6379/1")


@pytest.mark.asyncio
async def test_redis_ping_closes_client(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.ping_called = False
            self.closed = False

        async def ping(self) -> None:
            self.ping_called = True

        async def aclose(self) -> None:
            self.closed = True

    class FakeRedis:
        def __init__(self) -> None:
            self.client = FakeClient()

        def from_url(self, url: str) -> FakeClient:
            return self.client

    fake = FakeRedis()
    monkeypatch.setattr(redis_helpers, "REDIS_AVAILABLE", True, raising=False)
    monkeypatch.setattr(redis_helpers, "redis", fake, raising=False)

    await redis_helpers.ping("redis://localhost:6379/2")

    assert fake.client.ping_called is True
    assert fake.client.closed is True
