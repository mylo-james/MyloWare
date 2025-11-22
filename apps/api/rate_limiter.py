"""Lightweight rate limiting helpers with in-memory buckets."""
from __future__ import annotations

import asyncio
import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Awaitable, Callable, Deque, DefaultDict

from fastapi import HTTPException, Request, status
from prometheus_client import Counter

from .config import settings
from adapters.persistence.cache.rate_limiter import RedisRateLimiter


@dataclass
class RateLimitConfig:
    limit: int
    window_seconds: int


class _InMemoryLimiter:
    def __init__(self) -> None:
        self._buckets: DefaultDict[str, Deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, key: str, *, limit: int, window_seconds: int) -> tuple[bool, float]:
        """Return (allowed, retry_after_seconds)."""

        now = time.monotonic()
        async with self._lock:
            bucket = self._buckets[key]
            cutoff = now - window_seconds
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(0.0, window_seconds - (now - bucket[0]))
                return False, retry_after
            bucket.append(now)
            return True, 0.0

    def reset(self) -> None:
        self._buckets.clear()


class RateLimiter:
    """Rate limiter that can use in-memory or Redis-backed buckets."""

    def __init__(self) -> None:
        self._local = _InMemoryLimiter()
        self._redis: RedisRateLimiter | None = None

    def use_redis(self, redis_url: str) -> None:
        """Configure a Redis-backed limiter if available."""
        self._redis = RedisRateLimiter(redis_url)

    async def allow(self, key: str, *, config: RateLimitConfig) -> tuple[bool, float]:
        if self._redis is not None:
            return await self._redis.allow(key, config=config)
        return await self._local.check(key, limit=config.limit, window_seconds=config.window_seconds)

    def reset(self) -> None:
        self._local.reset()


RATE_LIMITS: dict[str, RateLimitConfig] = {
    "runs_start": RateLimitConfig(limit=10, window_seconds=60),
    "runs_continue": RateLimitConfig(limit=10, window_seconds=60),
    "hitl_approve": RateLimitConfig(limit=25, window_seconds=60),
    "chat_brendan": RateLimitConfig(limit=45, window_seconds=60),
}


_rate_limiter: RateLimiter | None = None


rate_limited_requests_total = Counter(
    "api_rate_limited_requests_total",
    "Total requests rejected due to rate limiting (by logical limiter name)",
    ["name"],
)


def get_rate_limiter() -> RateLimiter:
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
        if settings.use_redis_rate_limiting:
            try:
                _rate_limiter.use_redis(settings.redis_url)
            except Exception:
                # Fallback to in-memory limiting if Redis config is invalid/unavailable.
                pass
    return _rate_limiter


def rate_limit_dependency(name: str) -> Callable[[Request], Awaitable[None]]:
    limiter = get_rate_limiter()

    async def _dependency(request: Request) -> None:
        config = RATE_LIMITS[name]
        client_host = request.client.host if request.client else "unknown"
        api_key = request.headers.get("x-api-key")
        key = f"{name}:{api_key or client_host}"
        allowed, retry_after = await limiter.allow(key, config=config)
        if not allowed:
            try:
                rate_limited_requests_total.labels(name=name).inc()
            except Exception:
                # Metrics must never break request handling.
                pass
            headers = {"Retry-After": str(int(math.ceil(retry_after)) or 1)}
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="rate limit exceeded",
                headers=headers,
            )

    return _dependency


__all__ = [
    "RateLimitConfig",
    "RATE_LIMITS",
    "RateLimiter",
    "get_rate_limiter",
    "rate_limit_dependency",
    "rate_limited_requests_total",
]
