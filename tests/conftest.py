from __future__ import annotations

import os
import sys
import types

import pytest


def _ensure_langgraph_symbols() -> None:
    try:
        import langgraph.graph as graph_module  # type: ignore
    except ImportError:
        graph_module = types.ModuleType("langgraph.graph")
        sys.modules["langgraph.graph"] = graph_module
        langgraph_pkg = types.ModuleType("langgraph")
        langgraph_pkg.graph = graph_module  # type: ignore[attr-defined]
        sys.modules["langgraph"] = langgraph_pkg
    else:
        sys.modules["langgraph.graph"] = graph_module
    for attr in ("CompiledGraph", "StateGraph", "START", "END"):
        if not hasattr(graph_module, attr):
            setattr(graph_module, attr, object())


_ensure_langgraph_symbols()


@pytest.fixture(scope="session", autouse=True)
def enforce_mock_providers():
    """
    🚨 CRITICAL: Enforce mock mode for ALL tests to prevent expensive API calls.
    
    This fixture runs automatically for every test session and forces
    PROVIDERS_MODE=mock unless the test is explicitly marked with
    @pytest.mark.live_smoke.
    
    This prevents accidental $50+ test runs when PROVIDERS_MODE=live
    is set in your .env file or environment.
    
    To run live provider tests:
        pytest -m live_smoke tests/integration/live/
    
    This fixture ensures:
    - Unit tests NEVER hit live APIs
    - Integration tests use mocks by default
    - Only opt-in live tests can use real providers
    """
    original_value = os.environ.get("PROVIDERS_MODE")
    
    # Force mock mode for all tests by default
    os.environ["PROVIDERS_MODE"] = "mock"
    
    yield
    
    # Restore original value after test session
    if original_value is not None:
        os.environ["PROVIDERS_MODE"] = original_value
    else:
        os.environ.pop("PROVIDERS_MODE", None)


@pytest.fixture(autouse=True)
def ensure_mock_mode_per_test(request):
    """
    Per-test enforcement of mock mode.
    
    This fixture runs before each individual test to ensure
    PROVIDERS_MODE=mock is set, unless the test is marked
    with @pytest.mark.live_smoke.
    
    This provides defense-in-depth: even if the session fixture
    is bypassed, individual tests still get mock mode.
    """
    is_live_smoke_test = request.node.get_closest_marker("live_smoke") is not None
    
    if not is_live_smoke_test:
        # Force mock mode
        original = os.environ.get("PROVIDERS_MODE")
        os.environ["PROVIDERS_MODE"] = "mock"
        
        yield
        
        # Restore
        if original is not None:
            os.environ["PROVIDERS_MODE"] = original
        else:
            os.environ.pop("PROVIDERS_MODE", None)
    else:
        # Live smoke test - allow whatever is set
        yield
