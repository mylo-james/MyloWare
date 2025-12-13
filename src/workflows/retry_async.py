"""Async retry helpers."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Callable, TypeVar, Awaitable

T = TypeVar("T")


@dataclass
class AsyncRetryConfig:
    attempts: int = 3
    backoff_seconds: float = 1.5


async def async_with_retry(
    fn: Callable[[], Awaitable[T]], config: AsyncRetryConfig | None = None
) -> T:
    cfg = config or AsyncRetryConfig()
    attempt = 0
    while True:
        try:
            return await fn()
        except Exception:
            attempt += 1
            if attempt >= cfg.attempts:
                raise
            await asyncio.sleep(cfg.backoff_seconds * attempt)
