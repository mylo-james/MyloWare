"""Retry utilities with exponential backoff for workflow operations.

Provides resilient execution of workflow steps that may fail transiently
(e.g., webhook handlers, external service calls).
"""

from __future__ import annotations

import asyncio
import random
from functools import wraps
from typing import Any, Awaitable, Callable, TypeVar

from myloware.observability.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")

__all__ = [
    "with_retry",
    "async_with_retry",
    "RetryConfig",
    "MaxRetriesExceeded",
]


class MaxRetriesExceeded(Exception):
    """Raised when all retry attempts are exhausted."""

    def __init__(self, operation_name: str, attempts: int, last_exception: Exception | None = None):
        self.operation_name = operation_name
        self.attempts = attempts
        self.last_exception = last_exception
        super().__init__(
            f"{operation_name} failed after {attempts} attempts"
            + (f": {last_exception}" if last_exception else "")
        )


class RetryConfig:
    """Configuration for retry behavior."""

    def __init__(
        self,
        max_attempts: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        exponential_base: float = 2.0,
        retryable_exceptions: tuple[type[Exception], ...] = (Exception,),
    ):
        """Initialize retry configuration.

        Args:
            max_attempts: Maximum number of attempts (including first try)
            base_delay: Initial delay between retries in seconds
            max_delay: Maximum delay between retries in seconds
            exponential_base: Base for exponential backoff calculation
            retryable_exceptions: Exception types that should trigger retry
        """
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.retryable_exceptions = retryable_exceptions


# Default config for workflow operations
DEFAULT_CONFIG = RetryConfig(
    max_attempts=3,
    base_delay=2.0,
    max_delay=30.0,
)


def _calculate_delay(attempt: int, config: RetryConfig) -> float:
    """Calculate delay for a given attempt using exponential backoff with jitter.

    Adds 10% random jitter to prevent thundering herd problems.
    """
    delay = config.base_delay * (config.exponential_base**attempt)
    delay = min(delay, config.max_delay)
    # Add jitter: random value between 0 and 10% of delay
    # Non-crypto jitter for backoff scheduling.
    jitter = random.uniform(0, delay * 0.1)  # nosec B311
    return delay + jitter


async def async_with_retry(
    func: Callable[..., Awaitable[T]],
    *args: Any,
    config: RetryConfig | None = None,
    operation_name: str | None = None,
    **kwargs: Any,
) -> T:
    """Execute an async function with retry and exponential backoff.

    Args:
        func: Async function to execute
        *args: Positional arguments for func
        config: Retry configuration (uses DEFAULT_CONFIG if not provided)
        operation_name: Name for logging (defaults to func name)
        **kwargs: Keyword arguments for func

    Returns:
        Result from successful function execution

    Raises:
        Exception: The last exception if all attempts fail
    """
    config = config or DEFAULT_CONFIG
    name = operation_name or getattr(func, "__name__", "operation")

    last_exception: Exception | None = None

    for attempt in range(config.max_attempts):
        try:
            return await func(*args, **kwargs)
        except config.retryable_exceptions as exc:
            last_exception = exc

            if attempt + 1 >= config.max_attempts:
                logger.error(
                    "%s failed after %d attempts: %s",
                    name,
                    config.max_attempts,
                    exc,
                )
                raise MaxRetriesExceeded(name, config.max_attempts, exc)

            delay = _calculate_delay(attempt, config)
            logger.warning(
                "%s attempt %d/%d failed: %s. Retrying in %.1fs...",
                name,
                attempt + 1,
                config.max_attempts,
                exc,
                delay,
            )
            await asyncio.sleep(delay)

    # Should never reach here, but satisfy type checker
    raise last_exception or RuntimeError(f"{name} failed with no exception")


def with_retry(
    func: Callable[..., T],
    *args: Any,
    config: RetryConfig | None = None,
    operation_name: str | None = None,
    **kwargs: Any,
) -> T:
    """Execute a sync function with retry and exponential backoff.

    Args:
        func: Sync function to execute
        *args: Positional arguments for func
        config: Retry configuration (uses DEFAULT_CONFIG if not provided)
        operation_name: Name for logging (defaults to func name)
        **kwargs: Keyword arguments for func

    Returns:
        Result from successful function execution

    Raises:
        Exception: The last exception if all attempts fail
    """
    import time

    config = config or DEFAULT_CONFIG
    name = operation_name or getattr(func, "__name__", "operation")

    last_exception: Exception | None = None

    for attempt in range(config.max_attempts):
        try:
            return func(*args, **kwargs)
        except config.retryable_exceptions as exc:
            last_exception = exc

            if attempt + 1 >= config.max_attempts:
                logger.error(
                    "%s failed after %d attempts: %s",
                    name,
                    config.max_attempts,
                    exc,
                )
                raise MaxRetriesExceeded(name, config.max_attempts, exc)

            delay = _calculate_delay(attempt, config)
            logger.warning(
                "%s attempt %d/%d failed: %s. Retrying in %.1fs...",
                name,
                attempt + 1,
                config.max_attempts,
                exc,
                delay,
            )
            time.sleep(delay)

    # Should never reach here, but satisfy type checker
    raise last_exception or RuntimeError(f"{name} failed with no exception")


def retry_async(
    config: RetryConfig | None = None,
    operation_name: str | None = None,
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """Decorator for async functions with retry and exponential backoff.

    Usage:
        @retry_async(config=RetryConfig(max_attempts=5))
        async def my_func():
            ...
    """

    def decorator(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            return await async_with_retry(
                func,
                *args,
                config=config,
                operation_name=operation_name or func.__name__,
                **kwargs,
            )

        return wrapper

    return decorator
