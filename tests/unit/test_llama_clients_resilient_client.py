"""Unit tests for ResilientClient circuit-breaker wrapping."""

from __future__ import annotations

import pytest

from myloware.llama_clients import LlamaStackConnectionError, ResilientClient
from myloware.resilience.circuit_breaker import CircuitBreaker


def test_resilient_client_wraps_nested_resource_calls() -> None:
    """Nested resource methods (e.g., client.models.list) are circuit-breaker protected."""

    class FakeModels:
        def __init__(self) -> None:
            self.calls = 0

        def list(self):  # noqa: ANN001 - test double
            self.calls += 1
            raise RuntimeError("boom")

    class FakeClient:
        def __init__(self, models: FakeModels) -> None:
            self.models = models

    breaker = CircuitBreaker(name="test_llama_stack", failure_threshold=1, recovery_timeout=60.0)
    models = FakeModels()
    client = ResilientClient(FakeClient(models), circuit_breaker=breaker)

    with pytest.raises(RuntimeError, match="boom"):
        client.models.list()

    # Second call should be rejected by the circuit breaker without touching the underlying method.
    with pytest.raises(LlamaStackConnectionError, match="Circuit breaker is open"):
        client.models.list()

    assert models.calls == 1
