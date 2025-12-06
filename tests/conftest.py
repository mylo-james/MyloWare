"""Pytest configuration and shared fixtures."""

import pytest


def pytest_configure(config):
    """Configure pytest markers."""
    config.addinivalue_line("markers", "integration: marks tests as integration tests")


@pytest.fixture
def sample_brief() -> str:
    """Sample video brief for testing."""
    return "Create a 30-second video about AI technology trends"
