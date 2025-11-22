"""Shared retry helpers for outbound API calls."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

from tenacity import Retrying, retry_if_exception_type, stop_after_attempt, wait_exponential

T = TypeVar("T")


class RetryConfig:
    """Configuration for common retry policy."""

    def __init__(self, max_attempts: int = 5, min_wait: float = 1.0, max_wait: float = 32.0) -> None:
        self.max_attempts = max_attempts
        self.min_wait = min_wait
        self.max_wait = max_wait


def run_with_retry(fn: Callable[[], T], *, config: RetryConfig | None = None) -> T:
    """Execute a callable with exponential backoff.

    The helper keeps our adapters consistent with the story requirement of up to five attempts.
    """

    cfg = config or RetryConfig()
    retry = Retrying(
        reraise=True,
        stop=stop_after_attempt(cfg.max_attempts),
        wait=wait_exponential(multiplier=cfg.min_wait, max=cfg.max_wait),
        retry=retry_if_exception_type(Exception),
    )
    for attempt in retry:
        with attempt:
            return fn()
    raise RuntimeError("Retry loop exited unexpectedly")
