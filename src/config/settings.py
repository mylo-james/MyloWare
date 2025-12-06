"""Application settings using Pydantic."""

import os

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Project Configuration
    project_id: str = Field(
        default="myloware",
        description="Default project ID for knowledge base setup",
    )

    # Llama Stack Configuration
    llama_stack_url: str = "http://localhost:5001"
    llama_stack_model: str = "openai/gpt-4o-mini"

    # Database Configuration (use psycopg2 driver explicitly)
    database_url: str = "postgresql+psycopg2://myloware:myloware@localhost:5432/myloware"
    db_pool_size: int = Field(default=5, description="Database connection pool size")
    db_max_overflow: int = Field(default=10, description="Database connection pool max overflow")

    # API Configuration
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_key: str = "dev-api-key"  # Override in production

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, v: str) -> str:
        """Ensure default API key is not used in production."""
        if os.getenv("ENVIRONMENT") == "production" and v == "dev-api-key":
            raise ValueError("Cannot use default API key in production. Set API_KEY env var.")
        return v

    # External Service API Keys
    kie_api_key: str = ""
    kie_base_url: str = "https://api.kie.ai/v1"
    kie_signing_secret: str = Field(
        default="",
        description="HMAC secret for verifying KIE.ai webhook signatures",
    )

    remotion_service_url: str = Field(
        default="http://localhost:3001",
        description="Remotion render service URL",
    )
    remotion_webhook_secret: str = Field(
        default="",
        description="Secret for verifying Remotion webhooks",
    )

    upload_post_api_key: str = ""
    upload_post_api_url: str = Field(
        default="https://api.upload-post.com",
        description="Upload-Post API base URL (without /api/upload path)",
    )

    # Telegram
    telegram_bot_token: str = ""
    telegram_webhook_secret: str = ""
    telegram_allowed_chat_ids: list[str] = Field(default_factory=list)
    telegram_allow_all_chats: bool = Field(
        default=False,
        description="Allow all chats when telegram_allowed_chat_ids is empty",
    )

    # Webhooks
    webhook_base_url: str = Field(
        default="",
        description="Base URL for webhook callbacks (e.g., https://myloware.fly.dev)",
    )

    # Testing / fakes
    use_fake_providers: bool = Field(
        default=False,
        description="Use fake clients for KIE, Remotion, upload-post",
    )

    # Video Cache
    use_video_cache: bool = Field(
        default=False,
        description="Enable video caching - reuse previously generated KIE.ai videos",
    )
    cache_new_videos: bool = Field(
        default=True,
        description="Store newly generated videos in cache (requires topic/sign metadata)",
    )

    @model_validator(mode="after")
    def validate_webhook_url_for_production(self) -> "Settings":
        """Ensure webhook_base_url is set when not using fake providers."""
        if not self.use_fake_providers and not self.webhook_base_url:
            raise ValueError(
                "WEBHOOK_BASE_URL is required when USE_FAKE_PROVIDERS=False. "
                "Set it to your public API URL (e.g., https://myloware.fly.dev)"
            )
        return self

    # Observability
    log_level: str = "INFO"
    enable_telemetry: bool = True


# Global settings instance
settings = Settings()
