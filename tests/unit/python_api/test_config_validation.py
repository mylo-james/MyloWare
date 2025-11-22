from __future__ import annotations

import pytest
from pydantic import ValidationError

from apps.api.config import Settings as ApiSettings
from apps.orchestrator.config import Settings as OrchestratorSettings


def _force_default_api_env(monkeypatch: pytest.MonkeyPatch) -> None:
    defaults = {
        "API_KEY": "dev-local-api-key",
        "KIEAI_API_KEY": "dev-kieai",
        "KIEAI_SIGNING_SECRET": "kieai-secret",
        "SHOTSTACK_API_KEY": "dev-shotstack",
        "UPLOAD_POST_API_KEY": "dev-upload-post",
        "UPLOAD_POST_SIGNING_SECRET": "upload-post-secret",
    }
    for key, value in defaults.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("HITL_SECRET", raising=False)


def _force_default_orchestrator_env(monkeypatch: pytest.MonkeyPatch, environment: str) -> None:
    defaults = {
        "API_KEY": "dev-local-api-key",
        "KIEAI_API_KEY": "dev-kieai",
        "SHOTSTACK_API_KEY": "dev-shotstack",
        "UPLOAD_POST_API_KEY": "dev-upload-post",
    }
    for key, value in defaults.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("KIEAI_SIGNING_SECRET", raising=False)
    monkeypatch.setenv("ENVIRONMENT", environment)


def test_api_settings_reject_default_secrets_in_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    _force_default_api_env(monkeypatch)
    with pytest.raises(ValueError):
        ApiSettings(_env_file=None, environment="prod")


def test_api_settings_accept_strong_secrets_in_prod() -> None:
    settings = ApiSettings(
        _env_file=None,
        environment="prod",
        api_key="prod-api-key-123456",
        kieai_api_key="prod-kieai-key-123456",
        KIEAI_SIGNING_SECRET="prod-signing-secret-123456",
        shotstack_api_key="shotstack-key-123456",
        upload_post_api_key="upload-post-key-123456",
        UPLOAD_POST_SIGNING_SECRET="upload-post-signing-123456",
        HITL_SECRET="hitl-secret-123456",
    )
    assert settings.environment == "prod"


def test_api_settings_reject_default_secrets_in_staging(monkeypatch: pytest.MonkeyPatch) -> None:
    _force_default_api_env(monkeypatch)
    with pytest.raises(ValueError):
        ApiSettings(_env_file=None, environment="staging")


def test_api_settings_accept_strong_secrets_in_staging() -> None:
    settings = ApiSettings(
        _env_file=None,
        environment="staging",
        api_key="staging-api-key-123456",
        kieai_api_key="staging-kieai-key-123456",
        KIEAI_SIGNING_SECRET="staging-signing-secret-123456",
        shotstack_api_key="staging-shotstack-key-123456",
        upload_post_api_key="staging-upload-post-key-123456",
        UPLOAD_POST_SIGNING_SECRET="staging-upload-post-signing-123456",
        HITL_SECRET="staging-hitl-secret-123456",
    )
    assert settings.environment == "staging"


def test_api_settings_allow_defaults_in_local() -> None:
    settings = ApiSettings(_env_file=None, environment="local")
    assert settings.environment == "local"


def test_api_settings_default_providers_mode_is_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("FLY_APP_NAME", raising=False)
    monkeypatch.delenv("PROVIDERS_MODE", raising=False)
    monkeypatch.delenv("providers_mode", raising=False)
    settings = ApiSettings(_env_file=None)
    assert settings.providers_mode == "mock"


def test_api_settings_expose_provider_base_urls() -> None:
    settings = ApiSettings(_env_file=None)
    assert settings.kieai_base_url
    assert settings.shotstack_base_url
    assert settings.upload_post_base_url


def test_orchestrator_settings_reject_default_api_key_in_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    _force_default_orchestrator_env(monkeypatch, "prod")
    with pytest.raises(ValueError):
        OrchestratorSettings(_env_file=None, environment="prod", api_key="dev-local-api-key")


def test_orchestrator_settings_accept_custom_api_key_in_prod() -> None:
    settings = OrchestratorSettings(
        _env_file=None,
        environment="prod",
        api_key="prod-orch-key-123456",
        kieai_api_key="prod-kieai-key-123456",
        kieai_signing_secret="prod-kieai-signing-secret-123456",
        shotstack_api_key="prod-shotstack-key-123456",
        upload_post_api_key="prod-upload-key-123456",
        upload_post_signing_secret="prod-upload-signing-secret-123456",
    )
    assert settings.api_key == "prod-orch-key-123456"


def test_orchestrator_settings_reject_default_api_key_in_staging(monkeypatch: pytest.MonkeyPatch) -> None:
    _force_default_orchestrator_env(monkeypatch, "staging")
    with pytest.raises(ValueError):
        OrchestratorSettings(_env_file=None, environment="staging", api_key="dev-local-api-key")


def test_orchestrator_settings_accept_custom_api_key_in_staging() -> None:
    settings = OrchestratorSettings(
        _env_file=None,
        environment="staging",
        api_key="staging-orch-key-123456",
        kieai_api_key="staging-kieai-key-123456",
        kieai_signing_secret="staging-kieai-signing-secret-123456",
        shotstack_api_key="staging-shotstack-key-123456",
        upload_post_api_key="staging-upload-key-123456",
        upload_post_signing_secret="staging-upload-signing-secret-123456",
    )
    assert settings.api_key == "staging-orch-key-123456"


def test_orchestrator_settings_allow_defaults_in_local() -> None:
    settings = OrchestratorSettings(_env_file=None, environment="local")
    assert settings.environment == "local"
    assert settings.api_key


def test_orchestrator_settings_default_providers_mode_is_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("FLY_APP_NAME", raising=False)
    monkeypatch.delenv("PROVIDERS_MODE", raising=False)
    monkeypatch.delenv("providers_mode", raising=False)
    settings = OrchestratorSettings(_env_file=None)
    assert settings.providers_mode == "mock"


def test_orchestrator_settings_reject_invalid_providers_mode() -> None:
    with pytest.raises(ValidationError):
        OrchestratorSettings(_env_file=None, providers_mode="qa")  # type: ignore[arg-type]


def test_orchestrator_settings_expose_provider_credentials() -> None:
    settings = OrchestratorSettings(_env_file=None)
    assert settings.kieai_api_key
    assert settings.kieai_base_url
    assert settings.shotstack_api_key
    assert settings.shotstack_base_url
    assert settings.upload_post_api_key
    assert settings.upload_post_base_url
    assert settings.webhook_base_url
