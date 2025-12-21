"""Circuit breaker pattern for Llama Stack client calls.

Prevents cascading failures when Llama Stack is unavailable or slow.
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any, Callable, TypeVar

from myloware.config import settings
from myloware.observability.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


class CircuitState(str, Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing fast
    HALF_OPEN = "half_open"  # Testing recovery


class CircuitBreakerError(Exception):
    """Raised when circuit breaker is open."""

    pass


class CircuitBreaker:
    """Circuit breaker implementation.

    States:
    - CLOSED: Normal operation, calls pass through
    - OPEN: Failing fast, all calls rejected immediately
    - HALF_OPEN: Testing recovery, limited calls allowed

    Transitions:
    - CLOSED -> OPEN: After failure_threshold consecutive failures
    - OPEN -> HALF_OPEN: After recovery_timeout seconds
    - HALF_OPEN -> CLOSED: After successful call
    - HALF_OPEN -> OPEN: After failure in half-open state
    """

    def __init__(
        self,
        failure_threshold: int | None = None,
        recovery_timeout: float | None = None,
        half_open_max_calls: int = 3,
        name: str = "circuit_breaker",
    ):
        """Initialize circuit breaker.

        Args:
            failure_threshold: Number of failures before opening circuit
            recovery_timeout: Seconds to wait before attempting recovery
            half_open_max_calls: Max calls allowed in half-open state
            name: Name for logging
        """
        self.failure_threshold = failure_threshold or settings.circuit_breaker_failure_threshold
        self.recovery_timeout = recovery_timeout or settings.circuit_breaker_recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self.name = name

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: float | None = None
        self._half_open_calls = 0
        self._success_count = 0

    @property
    def state(self) -> CircuitState:
        """Get current circuit state."""
        # Check if we should transition from OPEN to HALF_OPEN
        if self._state == CircuitState.OPEN and self._last_failure_time:
            elapsed = time.time() - self._last_failure_time
            if elapsed >= self.recovery_timeout:
                logger.info(
                    "Circuit breaker %s transitioning OPEN -> HALF_OPEN (recovery timeout)",
                    self.name,
                )
                self._state = CircuitState.HALF_OPEN
                self._half_open_calls = 0
                self._success_count = 0

        return self._state

    def call(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Execute function with circuit breaker protection.

        Args:
            func: Function to call
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            Function result

        Raises:
            CircuitBreakerError: If circuit is open
        """
        current_state = self.state

        # Reject immediately if open
        if current_state == CircuitState.OPEN:
            logger.warning("Circuit breaker %s is OPEN, rejecting call", self.name)
            raise CircuitBreakerError(f"Circuit breaker {self.name} is OPEN")

        # Limit calls in half-open state
        if current_state == CircuitState.HALF_OPEN:
            if self._half_open_calls >= self.half_open_max_calls:
                logger.warning(
                    "Circuit breaker %s HALF_OPEN max calls reached, opening circuit",
                    self.name,
                )
                self._state = CircuitState.OPEN
                self._last_failure_time = time.time()
                raise CircuitBreakerError(f"Circuit breaker {self.name} exceeded half-open limit")

            self._half_open_calls += 1

        # Execute function
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception:
            self._on_failure()
            raise

    def _on_success(self) -> None:
        """Handle successful call."""
        if self._state == CircuitState.HALF_OPEN:
            self._success_count += 1
            # If we get a success in half-open, close the circuit
            if self._success_count >= 1:
                logger.info(
                    "Circuit breaker %s transitioning HALF_OPEN -> CLOSED (recovered)", self.name
                )
                self._state = CircuitState.CLOSED
                self._failure_count = 0
                self._half_open_calls = 0
                self._success_count = 0
                self._last_failure_time = None
        else:
            # Reset failure count on success in closed state
            self._failure_count = 0

    def _on_failure(self) -> None:
        """Handle failed call."""
        self._failure_count += 1
        self._last_failure_time = time.time()

        if self._state == CircuitState.HALF_OPEN:
            # Failure in half-open -> back to open
            logger.warning("Circuit breaker %s HALF_OPEN -> OPEN (failure detected)", self.name)
            self._state = CircuitState.OPEN
            self._half_open_calls = 0
            self._success_count = 0
        elif self._failure_count >= self.failure_threshold:
            # Too many failures in closed state -> open
            logger.warning(
                "Circuit breaker %s CLOSED -> OPEN (failure threshold: %d)",
                self.name,
                self.failure_threshold,
            )
            self._state = CircuitState.OPEN

    def reset(self) -> None:
        """Manually reset circuit breaker to closed state."""
        logger.info("Circuit breaker %s manually reset to CLOSED", self.name)
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time = None
        self._half_open_calls = 0
        self._success_count = 0
