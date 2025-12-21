from __future__ import annotations

import pytest

from myloware.workflows.retry_async import AsyncRetryConfig, async_with_retry


@pytest.mark.asyncio
async def test_async_with_retry_returns_value_first_try() -> None:
    async def fn() -> str:
        return "ok"

    assert await async_with_retry(fn, AsyncRetryConfig(attempts=3, backoff_seconds=0)) == "ok"


@pytest.mark.asyncio
async def test_async_with_retry_retries_until_success() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise RuntimeError("transient")
        return "done"

    out = await async_with_retry(fn, AsyncRetryConfig(attempts=5, backoff_seconds=0))
    assert out == "done"
    assert attempts == 3


@pytest.mark.asyncio
async def test_async_with_retry_raises_after_max_attempts() -> None:
    attempts = 0

    async def fn() -> None:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("always")

    with pytest.raises(RuntimeError, match="always"):
        await async_with_retry(fn, AsyncRetryConfig(attempts=2, backoff_seconds=0))
    assert attempts == 2
