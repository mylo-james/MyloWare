from __future__ import annotations

import asyncio
from typing import Any

import pytest

from adapters.persistence.cache.rate_limiter import RedisRateLimiter, RateLimitConfig


class DummyRedis:
    def __init__(self) -> None:
        self.store: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    async def expire(self, key: str, ttl: int) -> None:
        self.ttls[key] = ttl

    async def ttl(self, key: str) -> int:
        return self.ttls.get(key, -1)

    async def aclose(self) -> None:
        return None


class DummyConfig:
    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window_seconds = window_seconds


@pytest.mark.asyncio
async def test_redis_rate_limiter_allows_within_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    dummy = DummyRedis()

    def fake_get_async_client(url: str) -> Any:  # noqa: ARG001
        return dummy

    monkeypatch.setattr("adapters.persistence.cache.rate_limiter.get_async_client", fake_get_async_client)
    monkeypatch.setattr("adapters.persistence.cache.rate_limiter.is_available", lambda: True)

    limiter = RedisRateLimiter("redis://localhost:6379/0")
    config: RateLimitConfig = DummyConfig(limit=2, window_seconds=60)

    allowed1, retry1 = await limiter.allow("user:test", config=config)
    allowed2, retry2 = await limiter.allow("user:test", config=config)

    assert allowed1 is True and retry1 == 0.0
    assert allowed2 is True and retry2 == 0.0


@pytest.mark.asyncio
async def test_redis_rate_limiter_blocks_over_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    dummy = DummyRedis()

    def fake_get_async_client(url: str) -> Any:  # noqa: ARG001
        return dummy

    monkeypatch.setattr("adapters.persistence.cache.rate_limiter.get_async_client", fake_get_async_client)
    monkeypatch.setattr("adapters.persistence.cache.rate_limiter.is_available", lambda: True)

    limiter = RedisRateLimiter("redis://localhost:6379/0")
    config: RateLimitConfig = DummyConfig(limit=1, window_seconds=30)

    allowed1, retry1 = await limiter.allow("user:test", config=config)
    allowed2, retry2 = await limiter.allow("user:test", config=config)

    assert allowed1 is True and retry1 == 0.0
    assert allowed2 is False
    assert retry2 >= 0.0

