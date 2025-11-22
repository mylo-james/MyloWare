"""Simple circuit breaker for outbound provider calls.

The implementation is intentionally lightweight:

- Tracks consecutive failures per component.
- Opens the circuit when a configurable threshold is exceeded.
- While open, calls fail fast with :class:`CircuitOpenError`.
- After a cooldown, the breaker transitions to HALF_OPEN and allows a single
  trial call; a success closes the circuit, while a failure re-opens it.

This keeps reliability logic centralized and makes it easy to wrap external
provider calls (kie.ai, Shotstack, upload-post, etc.) without leaking their
details into the service layer.
"""
from __future__ import annotations

from collections.abc import Callable
import logging
from typing import TypeVar

from prometheus_client import Counter

T = TypeVar("T")

logger = logging.getLogger("myloware.infrastructure.circuit_breaker")

# Use an indirection so tests can monkeypatch time without affecting other modules.
from time import monotonic as time_monotonic  # noqa: E402


circuit_state_changes = Counter(
    "circuit_state_changes_total",
    "Circuit breaker state transitions",
    ["component", "state"],
)


class CircuitOpenError(RuntimeError):
    """Raised when a call is attempted while the circuit is open."""


class CircuitBreaker:
    """Circuit breaker tracking failures for a single logical component."""

    def __init__(
        self,
        *,
        name: str,
        max_failures: int = 5,
        reset_timeout_seconds: float = 30.0,
    ) -> None:
        if max_failures < 1:
            raise ValueError("max_failures must be at least 1")
        self._name = name
        self._max_failures = max_failures
        self._reset_timeout_seconds = reset_timeout_seconds
        self._state: str = "closed"  # CLOSED | OPEN | HALF_OPEN
        self._failure_count: int = 0
        self._opened_at: float | None = None

    def call(self, fn: Callable[[], T]) -> T:
        """Execute ``fn`` under circuit breaker control.

        - If the circuit is OPEN and still within the reset window, raise
          :class:`CircuitOpenError` without invoking ``fn``.
        - Otherwise, invoke ``fn``. Failures increment the failure counter and
          may open the circuit; successes reset the failure counter and close
          the circuit if it was HALF_OPEN.
        """
        if not self._allow_call():
            raise CircuitOpenError(f"Circuit for {self._name} is open")

        try:
            result = fn()
        except Exception:
            self._record_failure()
            raise
        else:
            self._record_success()
            return result

    # Internal helpers -----------------------------------------------------

    def _allow_call(self) -> bool:
        now = time_monotonic()
        if self._state == "open":
            # Still within the cooldown window: fail fast.
            if self._opened_at is not None and (now - self._opened_at) < self._reset_timeout_seconds:
                logger.warning(
                    "Circuit open; rejecting call",
                    extra={"component": self._name},
                )
                return False
            # Cooldown has elapsed; move to HALF_OPEN and allow a trial call.
            self._state = "half_open"
        return True

    def _record_failure(self) -> None:
        if self._state in {"half_open", "open"}:
            # Any failure while half-open immediately re-opens the circuit and
            # restarts the cooldown window.
            self._open()
            return

        self._failure_count += 1
        if self._failure_count >= self._max_failures:
            self._open()

    def _record_success(self) -> None:
        # Any success while HALF_OPEN or OPEN closes the circuit and resets
        # counters; otherwise we just clear failures.
        if self._state in {"half_open", "open"}:
            self._state = "closed"
            self._failure_count = 0
            self._opened_at = None
            logger.info(
                "Circuit closed",
                extra={"component": self._name},
            )
            circuit_state_changes.labels(component=self._name, state="closed").inc()
        else:
            self._failure_count = 0

    def _open(self) -> None:
        if self._state == "open":
            return
        self._state = "open"
        self._opened_at = time_monotonic()
        logger.error(
            "Circuit opened",
            extra={"component": self._name},
        )
        circuit_state_changes.labels(component=self._name, state="open").inc()


__all__ = ["CircuitBreaker", "CircuitOpenError", "circuit_state_changes"]

