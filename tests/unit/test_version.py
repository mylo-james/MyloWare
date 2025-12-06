"""Test package version and imports."""

from importlib.metadata import version

from config import settings


def test_version_exists():
    """Verify package has a version string."""
    pkg_version = version("myloware")
    assert isinstance(pkg_version, str)
    assert pkg_version == "0.1.0"


def test_settings_loads():
    """Verify settings can be loaded."""
    assert settings is not None
    assert settings.llama_stack_url == "http://localhost:5001"


def test_no_langchain_imports():
    """Verify LangChain is not importable (not installed)."""
    import sys

    assert "langchain" not in sys.modules
    assert "langgraph" not in sys.modules
