from __future__ import annotations

# mypy: ignore-errors

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = Field(default="local")
    api_base_url: AnyHttpUrl = Field(default="http://api:8080")
    orchestrator_base_url: AnyHttpUrl = Field(default="http://orchestrator:8090")
    api_key: str = Field(default="dev-local-api-key")

    host: str = Field(default="0.0.0.0")
    port: int = Field(default=3000)
    request_timeout_seconds: int = Field(default=30)


def get_settings() -> Settings:
    return Settings()
