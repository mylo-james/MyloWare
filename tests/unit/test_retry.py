from __future__ import annotations

import pytest

from myloware.workflows.retry import (
    MaxRetriesExceeded,
    RetryConfig,
    async_with_retry,
    retry_async,
    with_retry,
)


def test_with_retry_returns_on_first_try(monkeypatch) -> None:
    monkeypatch.setattr("myloware.workflows.retry.random.uniform", lambda *_a, **_kw: 0.0)

    assert (
        with_retry(lambda: "ok", config=RetryConfig(max_attempts=3, base_delay=0, max_delay=0))
        == "ok"
    )

    with pytest.raises(RuntimeError, match="failed with no exception"):
        with_retry(lambda: "x", config=RetryConfig(max_attempts=0, base_delay=0, max_delay=0))


def test_with_retry_raises_max_retries_exceeded(monkeypatch) -> None:
    monkeypatch.setattr("myloware.workflows.retry.random.uniform", lambda *_a, **_kw: 0.0)

    calls = {"n": 0}

    def always_fail() -> None:
        calls["n"] += 1
        raise ValueError("boom")

    with pytest.raises(MaxRetriesExceeded) as excinfo:
        with_retry(
            always_fail,
            config=RetryConfig(max_attempts=2, base_delay=0, max_delay=0),
            operation_name="op",
        )

    err = excinfo.value
    assert err.operation_name == "op"
    assert err.attempts == 2
    assert isinstance(err.last_exception, ValueError)
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_async_with_retry_retries_then_succeeds(monkeypatch) -> None:
    monkeypatch.setattr("myloware.workflows.retry.random.uniform", lambda *_a, **_kw: 0.0)

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("myloware.workflows.retry.asyncio.sleep", fake_sleep)

    calls = {"n": 0}

    async def sometimes_fail() -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("transient")
        return "done"

    out = await async_with_retry(
        sometimes_fail,
        config=RetryConfig(max_attempts=5, base_delay=0, max_delay=0),
        operation_name="op",
    )
    assert out == "done"
    assert calls["n"] == 3


@pytest.mark.asyncio
async def test_async_with_retry_raises_max_retries_exceeded(monkeypatch) -> None:
    monkeypatch.setattr("myloware.workflows.retry.random.uniform", lambda *_a, **_kw: 0.0)

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("myloware.workflows.retry.asyncio.sleep", fake_sleep)

    calls = {"n": 0}

    async def always_fail() -> None:
        calls["n"] += 1
        raise ValueError("boom")

    with pytest.raises(MaxRetriesExceeded, match="op failed after 2 attempts"):
        await async_with_retry(
            always_fail,
            config=RetryConfig(max_attempts=2, base_delay=0, max_delay=0),
            operation_name="op",
        )

    assert calls["n"] == 2

    with pytest.raises(RuntimeError, match="failed with no exception"):
        await async_with_retry(
            always_fail,
            config=RetryConfig(max_attempts=0, base_delay=0, max_delay=0),
            operation_name="op",
        )


@pytest.mark.asyncio
async def test_retry_async_decorator(monkeypatch) -> None:
    monkeypatch.setattr("myloware.workflows.retry.random.uniform", lambda *_a, **_kw: 0.0)

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("myloware.workflows.retry.asyncio.sleep", fake_sleep)

    calls = {"n": 0}

    @retry_async(config=RetryConfig(max_attempts=3, base_delay=0, max_delay=0), operation_name="x")
    async def f() -> str:
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("transient")
        return "ok"

    assert await f() == "ok"
    assert calls["n"] == 2
