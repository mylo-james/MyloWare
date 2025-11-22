from __future__ import annotations

"""Redis-backed rate limiter for distributed API instances."""

from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from .redis import get_async_client, is_available


class RateLimitConfig(Protocol):
    limit: int
    window_seconds: int


class RedisRateLimiter:
    """Simple fixed-window rate limiter implemented on top of Redis.

    Uses INCR + EXPIRE on a per-key basis. The first request in a new window
    sets the TTL; subsequent requests reuse it to compute retry_after.
    """

    def __init__(self, redis_url: str) -> None:
        if not is_available():  # pragma: no cover - guarded by optional dependency
            raise RuntimeError("redis is not available")
        self._url = redis_url

    async def allow(self, key: str, *, config: RateLimitConfig) -> tuple[bool, float]:
        """Return (allowed, retry_after_seconds) for the given key."""
        client = get_async_client(self._url)
        try:
            # Increment the counter for this key
            current = await client.incr(key)
            # Set window TTL on first hit
            if current == 1:
                await client.expire(key, config.window_seconds)
                return True, 0.0

            if current <= config.limit:
                # Still within the window and under the limit
                return True, 0.0

            # Over limit: compute retry_after from remaining TTL
            ttl = await client.ttl(key)
            # Redis may return -1 (no expiry) or -2 (key missing); guard for those
            if ttl is None or ttl < 0:
                retry_after = float(config.window_seconds)
            else:
                retry_after = float(ttl)
            return False, max(0.0, retry_after)
        finally:
            try:
                await client.aclose()
            except Exception:  # pragma: no cover - best effort cleanup
                pass


__all__ = ["RedisRateLimiter"]

