from __future__ import annotations

from typing import Any

try:  # optional dependency
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except Exception:  # pragma: no cover
    redis = None  # type: ignore[assignment]
    REDIS_AVAILABLE = False


def is_available() -> bool:
    return REDIS_AVAILABLE


def get_async_client(url: str) -> Any:
    if not REDIS_AVAILABLE:  # pragma: no cover
        raise RuntimeError("redis is not installed")
    return redis.from_url(url)


async def ping(url: str) -> None:
    if not REDIS_AVAILABLE:
        return
    client = get_async_client(url)
    try:
        await client.ping()
    finally:
        try:
            await client.aclose()
        except Exception:
            pass

__all__ = ["is_available", "get_async_client", "ping"]

