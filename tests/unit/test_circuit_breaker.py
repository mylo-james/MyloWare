"""Unit tests for circuit breaker."""

import pytest
import time

from myloware.resilience.circuit_breaker import CircuitBreaker, CircuitBreakerError, CircuitState


def test_circuit_breaker_closed_state():
    """Test circuit breaker in closed state allows calls."""
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=1.0)

    assert cb.state == CircuitState.CLOSED

    # Successful call
    result = cb.call(lambda: "success")
    assert result == "success"
    assert cb.state == CircuitState.CLOSED


def test_circuit_breaker_opens_after_threshold():
    """Test circuit breaker opens after failure threshold."""
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=1.0)

    # Fail 3 times
    for _ in range(3):
        try:
            cb.call(lambda: (_ for _ in ()).throw(Exception("test error")))
        except Exception:
            pass

    assert cb.state == CircuitState.OPEN


def test_circuit_breaker_rejects_when_open():
    """Test circuit breaker rejects calls when open."""
    cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)

    # Trigger open
    try:
        cb.call(lambda: (_ for _ in ()).throw(Exception("test")))
    except Exception:
        pass

    assert cb.state == CircuitState.OPEN

    # Should reject immediately
    with pytest.raises(CircuitBreakerError):
        cb.call(lambda: "should not execute")


def test_circuit_breaker_half_open_recovery():
    """Test circuit breaker transitions to half-open after timeout."""
    cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)

    # Trigger open
    try:
        cb.call(lambda: (_ for _ in ()).throw(Exception("test")))
    except Exception:
        pass

    assert cb.state == CircuitState.OPEN

    # Wait for recovery timeout
    time.sleep(0.15)

    # Should be half-open
    assert cb.state == CircuitState.HALF_OPEN


def test_circuit_breaker_closes_on_success_in_half_open():
    """Test circuit breaker closes on success in half-open state."""
    cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1, half_open_max_calls=3)

    # Trigger open
    try:
        cb.call(lambda: (_ for _ in ()).throw(Exception("test")))
    except Exception:
        pass

    # Wait for recovery
    time.sleep(0.15)
    assert cb.state == CircuitState.HALF_OPEN

    # Success should close circuit
    result = cb.call(lambda: "success")
    assert result == "success"
    assert cb.state == CircuitState.CLOSED


def test_circuit_breaker_reset():
    """Test manual reset of circuit breaker."""
    cb = CircuitBreaker(failure_threshold=1, recovery_timeout=1.0)

    # Trigger open
    try:
        cb.call(lambda: (_ for _ in ()).throw(Exception("test")))
    except Exception:
        pass

    assert cb.state == CircuitState.OPEN

    # Reset
    cb.reset()
    assert cb.state == CircuitState.CLOSED


def test_circuit_breaker_half_open_max_calls_opens_circuit():
    cb = CircuitBreaker(failure_threshold=1, recovery_timeout=1.0, half_open_max_calls=1)
    cb._state = CircuitState.HALF_OPEN
    cb._half_open_calls = 1

    with pytest.raises(CircuitBreakerError, match="exceeded half-open limit"):
        cb.call(lambda: "nope")

    assert cb.state == CircuitState.OPEN


def test_circuit_breaker_failure_in_half_open_reopens_circuit():
    cb = CircuitBreaker(failure_threshold=10, recovery_timeout=1.0, half_open_max_calls=3)
    cb._state = CircuitState.HALF_OPEN
    cb._half_open_calls = 1
    cb._success_count = 1

    with pytest.raises(Exception, match="boom"):
        cb.call(lambda: (_ for _ in ()).throw(Exception("boom")))

    assert cb.state == CircuitState.OPEN
    assert cb._half_open_calls == 0
    assert cb._success_count == 0
