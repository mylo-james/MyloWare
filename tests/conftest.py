"""Pytest configuration and shared fixtures."""

import os
import sys
from pathlib import Path

import pytest

# Ensure source tree is importable without editable install (Python >=3.12 not always available)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))


def pytest_configure(config):
    """Configure pytest markers and environment for tests."""
    config.addinivalue_line("markers", "integration: marks tests as integration tests")

    # Set safe defaults for unit tests to avoid external dependencies
    # These can be overridden by individual tests that need different behavior
    os.environ.setdefault("LLAMA_STACK_PROVIDER", "fake")
    os.environ.setdefault("SORA_PROVIDER", "fake")
    os.environ.setdefault("REMOTION_PROVIDER", "fake")
    os.environ.setdefault("UPLOAD_POST_PROVIDER", "fake")
    os.environ.setdefault("DISABLE_BACKGROUND_WORKFLOWS", "true")
    os.environ.setdefault("FAIL_FAST_ON_STARTUP", "false")
    os.environ.setdefault("WEBHOOK_BASE_URL", "http://localhost:8000")
    # Force SQLite for tests to avoid PostgreSQL schema issues
    # Tests that need a specific DB should set settings.database_url explicitly
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_default.db"


@pytest.fixture
def anyio_backend() -> str:
    """Run anyio tests on asyncio (SQLAlchemy/asyncio-based stack)."""
    return "asyncio"


@pytest.fixture
def sample_brief() -> str:
    """Sample video brief for testing."""
    return "Create a 30-second video about AI technology trends"


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset rate limiter state between tests to avoid collision."""
    try:
        from api.server import limiter

        # Clear SlowAPI limiter storage before each test
        if hasattr(limiter, "_limiter") and limiter._limiter:
            storage = limiter._limiter.storage
            if hasattr(storage, "reset"):
                storage.reset()
            elif hasattr(storage, "storage"):
                # In-memory storage - clear the dict
                storage.storage.clear()
    except ImportError:
        pass  # server not imported yet

    yield

    # Clean up after test as well
    try:
        from api.server import limiter

        if hasattr(limiter, "_limiter") and limiter._limiter:
            storage = limiter._limiter.storage
            if hasattr(storage, "reset"):
                storage.reset()
            elif hasattr(storage, "storage"):
                storage.storage.clear()
    except ImportError:
        pass


@pytest.fixture
def api_headers() -> dict[str, str]:
    """Default API headers for authenticated endpoints."""
    from config import settings

    return {"X-API-Key": settings.api_key}


@pytest.fixture
async def async_client():
    """httpx AsyncClient wired to the FastAPI app with lifespan enabled."""
    from httpx import ASGITransport, AsyncClient

    from api.server import app

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
