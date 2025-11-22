from __future__ import annotations

import pytest

from infrastructure.circuit_breaker import CircuitBreaker, CircuitOpenError


def test_circuit_opens_after_max_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    # Freeze time so we can deterministically control the breaker behaviour.
    current_time = [0.0]

    def fake_monotonic() -> float:
        return current_time[0]

    monkeypatch.setattr("infrastructure.circuit_breaker.time_monotonic", fake_monotonic)

    breaker = CircuitBreaker(name="test-provider", max_failures=2, reset_timeout_seconds=30.0)

    calls: list[str] = []

    def failing_call() -> None:
        calls.append("fail")
        raise RuntimeError("boom")

    # First two attempts should execute the callable and propagate the error.
    with pytest.raises(RuntimeError):
        breaker.call(failing_call)
    with pytest.raises(RuntimeError):
        breaker.call(failing_call)

    assert calls == ["fail", "fail"]

    # After reaching the failure threshold, the circuit should be open and
    # subsequent calls should fail fast with CircuitOpenError.
    with pytest.raises(CircuitOpenError):
        breaker.call(lambda: None)


def test_circuit_half_open_and_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    current_time = [0.0]

    def fake_monotonic() -> float:
        return current_time[0]

    monkeypatch.setattr("infrastructure.circuit_breaker.time_monotonic", fake_monotonic)

    breaker = CircuitBreaker(name="test-provider", max_failures=1, reset_timeout_seconds=10.0)

    def failing_call() -> None:
        raise RuntimeError("boom")

    # Initial failure moves the breaker into OPEN state.
    with pytest.raises(RuntimeError):
        breaker.call(failing_call)

    # While the circuit is open and within the reset window, calls fail fast.
    with pytest.raises(CircuitOpenError):
        breaker.call(lambda: "should-not-run")

    # Advance time past the reset timeout so that the next call is allowed in HALF_OPEN.
    current_time[0] = 11.0

    result = breaker.call(lambda: "ok")
    assert result == "ok"

    # After a successful half-open call, the breaker should be closed again and
    # subsequent calls should execute normally.
    assert breaker.call(lambda: "second-ok") == "second-ok"

