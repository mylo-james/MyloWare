"""Configuration helpers for the FastAPI service."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal, cast

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _infer_environment_from_process() -> Literal["local", "staging", "prod"]:
    """Derive environment from ENVIRONMENT or Fly app name."""

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


def _default_public_base_url() -> str:
    env = _infer_environment_from_process()
    if env in {"staging", "prod"}:
        return "https://myloware-api.mjames.dev"
    return "http://localhost:8080"


def _default_webhook_base_url() -> str:
    return _default_public_base_url()


def _default_orchestrator_base_url() -> str:
    env = _infer_environment_from_process()
    if env == "staging":
        return "https://myloware-orchestrator-staging.fly.dev"
    if env == "prod":
        return "https://myloware-orchestrator.fly.dev"
    return "http://localhost:8090"


def _default_providers_mode() -> Literal["mock", "live"]:
    # Default to mock unless explicitly overridden via PROVIDERS_MODE.
    return "mock"


def _default_upload_post_base_url() -> str:
    env = _infer_environment_from_process()
    if env == "staging":
        return "https://api.upload-post.dev"
    return "https://api.upload-post.com/api"


class Settings(BaseSettings):
    """Centralized environment configuration."""

    api_key: str = "dev-local-api-key"
    # nosec B105 - Default local development credentials, overridden by DB_URL env var in production
    db_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/myloware"
    redis_url: str = "redis://localhost:6379/0"
    use_redis_rate_limiting: bool = Field(
        default=False,
        validation_alias=AliasChoices("USE_REDIS_RATE_LIMITING"),
    )
    telegram_bot_token: str | None = None
    langsmith_api_key: str | None = None
    langsmith_project: str = "myloware-dev"
    sentry_dsn: str | None = None
    environment: Literal["local", "staging", "prod"] = Field(
        default_factory=_infer_environment_from_process,
        validation_alias=AliasChoices("ENVIRONMENT"),
    )
    strict_startup_checks: bool = Field(
        default=False,
        validation_alias=AliasChoices("STRICT_STARTUP_CHECKS"),
    )
    version: str = "0.1.0"
    prom_endpoint: str = "http://localhost:9090"
    public_base_url: str = Field(
        default_factory=_default_public_base_url,
        validation_alias=AliasChoices("PUBLIC_BASE_URL"),
    )
    webhook_base_url: str = Field(
        default_factory=_default_webhook_base_url,
        validation_alias=AliasChoices("WEBHOOK_BASE_URL"),
    )
    providers_mode: Literal["mock", "live"] = Field(
        default_factory=_default_providers_mode,
        validation_alias=AliasChoices("PROVIDERS_MODE", "providers_mode"),
    )
    request_timeout_seconds: int = 30
    kieai_api_key: str = "dev-kieai"
    kieai_base_url: str = "https://api.kie.ai/api/v1/veo"
    kieai_signing_secret: str = Field(
        "kieai-secret",
        validation_alias=AliasChoices("KIEAI_SIGNING_SECRET", "KIEAI_SECRET"),
    )
    kieai_model: str = "veo3_fast"
    kieai_default_duration: int = 5
    kieai_default_quality: str = "720p"
    kieai_default_aspect_ratio: str = "16:9"
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
    hitl_secret: str | None = Field(
        default=None,
        validation_alias=AliasChoices("HITL_SECRET"),
    )
    orchestrator_base_url: str = Field(
        default_factory=_default_orchestrator_base_url,
        validation_alias=AliasChoices("ORCHESTRATOR_BASE_URL"),
    )
    mcp_base_url: str = Field(default="http://localhost:3000", validation_alias=AliasChoices("MCP_BASE_URL"))
    mcp_api_key: str | None = Field(default=None, validation_alias=AliasChoices("MCP_API_KEY", "MCP_AUTH_KEY"))
    provider_cache_dir: str = Field(default="/app/.cache/myloware/providers")
    rag_persona_prompts: bool = Field(
        default=True,
        validation_alias=AliasChoices("RAG_PERSONA_PROMPTS", "USE_RAG_PERSONA_PROMPTS"),
    )
    enable_content_safety: bool = Field(
        default=False,
        validation_alias=AliasChoices("ENABLE_CONTENT_SAFETY"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="allow",
        populate_by_name=True,
    )

    @model_validator(mode="after")
    def _validate_secrets(self) -> "Settings":
        env = str(self.environment).lower()
        if env in {"staging", "prod"}:
            defaults = {
                "api_key": "dev-local-api-key",
                "kieai_api_key": "dev-kieai",
                "kieai_signing_secret": "kieai-secret",
                "shotstack_api_key": "dev-shotstack",
                "upload_post_api_key": "dev-upload-post",
                "upload_post_signing_secret": "upload-post-secret",
            }
            for field, default_value in defaults.items():
                value = getattr(self, field, None)
                if value == default_value or not value:
                    raise ValueError(f"{field} must be overridden in {env}")
            if not self.hitl_secret:
                raise ValueError(f"hitl_secret must be set in {env}")
            min_secret_length = 12
            for field in [
                "api_key",
                "kieai_api_key",
                "kieai_signing_secret",
                "shotstack_api_key",
                "upload_post_api_key",
                "upload_post_signing_secret",
                "hitl_secret",
            ]:
                value = getattr(self, field, "")
                if not value or len(str(value)) < min_secret_length:
                    raise ValueError(f"{field} must be at least {min_secret_length} characters in {env}")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached settings instance."""

    return Settings()  # type: ignore[call-arg]


settings = get_settings()
