"""Settings for the LangGraph orchestrator server."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal, cast

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _infer_environment_from_process() -> Literal["local", "staging", "prod"]:
    override = os.getenv("ENVIRONMENT")
    if override:
        normalized = override.strip().lower()
        if normalized in {"local", "staging", "prod"}:
            return cast(Literal["local", "staging", "prod"], normalized)
    app_name = os.getenv("FLY_APP_NAME", "").lower()
    if app_name.endswith("-staging"):
        return "staging"
    if app_name.endswith("-prod") or app_name.endswith("-production"):
        return "prod"
    return "local"


def _default_api_base_url() -> str:
    env = _infer_environment_from_process()
    if env in {"staging", "prod"}:
        return "https://myloware-api-staging.fly.dev" if env == "staging" else "https://myloware-api.fly.dev"
    return "http://localhost:8080"


def _default_orchestrator_base_url() -> str:
    env = _infer_environment_from_process()
    if env == "staging":
        return "https://myloware-orchestrator-staging.fly.dev"
    if env == "prod":
        return "https://myloware-orchestrator.fly.dev"
    return "http://localhost:8090"


def _default_webhook_base_url() -> str:
    env = _infer_environment_from_process()
    if env in {"staging", "prod"}:
        return "https://myloware-api.mjames.dev"
    return "http://localhost:8080"


def _default_providers_mode() -> Literal["mock", "live"]:
    # Safety default: mock mode unless PROVIDERS_MODE explicitly set.
    return "mock"


def _default_upload_post_base_url() -> str:
    env = _infer_environment_from_process()
    if env == "staging":
        return "https://api.upload-post.dev"
    return "https://api.upload-post.com/api"


def _default_enable_langchain_personas() -> bool:
    return _infer_environment_from_process() != "local"


class Settings(BaseSettings):
    # nosec B105 - Default local development credentials, overridden by DB_URL env var in production
    db_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/myloware"
    api_key: str = "dev-local-api-key"
    api_base_url: str = Field(
        default_factory=_default_api_base_url,
        validation_alias=AliasChoices("API_BASE_URL"),
    )
    orchestrator_base_url: str = Field(
        default_factory=_default_orchestrator_base_url,
        validation_alias=AliasChoices("ORCHESTRATOR_BASE_URL"),
    )
    webhook_base_url: str = Field(
        default_factory=_default_webhook_base_url,
        validation_alias=AliasChoices("WEBHOOK_BASE_URL"),
    )
    providers_mode: Literal["mock", "live"] = Field(
        default_factory=_default_providers_mode,
        validation_alias=AliasChoices("PROVIDERS_MODE", "providers_mode"),
    )
    kieai_api_key: str = "dev-kieai"
    kieai_base_url: str = "https://api.kie.ai/api/v1/veo"
    # Default model slug for kie.ai; can be overridden via env
    kieai_model: str = Field(
        default="veo3_fast",
        validation_alias=AliasChoices("KIEAI_MODEL"),
    )
    kieai_signing_secret: str | None = None
    shotstack_api_key: str = "dev-shotstack"
    shotstack_base_url: str = "https://api.shotstack.io"
    upload_post_api_key: str = "dev-upload-post"
    upload_post_base_url: str = Field(
        default_factory=_default_upload_post_base_url,
        validation_alias=AliasChoices("UPLOAD_POST_BASE_URL"),
    )
    upload_post_signing_secret: str = Field(
        "upload-post-secret",
        validation_alias=AliasChoices("UPLOAD_POST_SIGNING_SECRET", "UPLOAD_POST_SECRET"),
    )
    artifact_sync_enabled: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str = "myloware-dev"
    environment: str = Field(
        default_factory=_infer_environment_from_process,
        validation_alias=AliasChoices("ENVIRONMENT"),
    )
    version: str = "0.1.0"
    sentry_dsn: str | None = None
    enable_langchain_personas: bool = Field(
        default_factory=_default_enable_langchain_personas,
        validation_alias=AliasChoices("ENABLE_LANGCHAIN_PERSONAS"),
    )
    persona_allowlist_mode: Literal["fail_fast", "memory_fallback"] = Field(
        default="fail_fast",
        validation_alias=AliasChoices("PERSONA_ALLOWLIST_MODE"),
    )
    strict_startup_checks: bool = Field(
        default=False,
        validation_alias=AliasChoices("STRICT_STARTUP_CHECKS"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="allow",
        populate_by_name=True,
    )

    @model_validator(mode="after")
    def _validate_prod_keys(self) -> "Settings":
        env = str(self.environment).lower()
        if env in {"staging", "prod"}:
            defaults = {
                "api_key": "dev-local-api-key",
                "kieai_api_key": "dev-kieai",
                "kieai_signing_secret": "",
                "shotstack_api_key": "dev-shotstack",
                "upload_post_api_key": "dev-upload-post",
            }
            for field, default_value in defaults.items():
                value = getattr(self, field, "")
                if value == default_value or not value:
                    raise ValueError(f"{field} must be overridden in {env}")
                if len(str(value)) < 12:
                    raise ValueError(f"{field} must be at least 12 characters in {env}")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
