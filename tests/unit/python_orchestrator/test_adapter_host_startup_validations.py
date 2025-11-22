from __future__ import annotations

import pytest

from apps.orchestrator.config import Settings
from apps.orchestrator.startup_validations import validate_adapter_hosts


def test_validate_adapter_hosts_accepts_default_hosts_local_env() -> None:
    """Default adapter base URLs should pass host validation in local env."""

    settings = Settings(environment="local")
    # Should not raise for the shipped defaults.
    validate_adapter_hosts(settings)


def test_validate_adapter_hosts_raises_on_invalid_host() -> None:
    """Misconfigured adapter hosts must fail fast during startup validation."""

    settings = Settings(environment="local")
    # Point Shotstack at an invalid host; validation should now fail.
    settings.shotstack_base_url = "https://evil.example.com"

    with pytest.raises(ValueError):
        validate_adapter_hosts(settings)

