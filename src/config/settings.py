"""Application settings using Pydantic."""

import os
from typing import Any, Literal

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

    # Knowledge Base / RAG Configuration
    # Vector store is auto-created with name: project_kb_{project_id}
    # Uses pgvector provider with OpenAI embeddings for fast, reliable RAG

    # Environment
    environment: str = Field(
        default=os.getenv("ENVIRONMENT", "development"),
        description="Deployment environment (development|staging|production)",
    )

    # Llama Stack Configuration
    llama_stack_url: str = "http://localhost:5001"
    llama_stack_model: str = "openai/gpt-5-nano"
    llama_stack_provider: Literal["real", "fake", "off"] = Field(
        default="real",
        description="Llama Stack provider mode: real=call Llama Stack, fake=local stubs, off=disable.",
    )
    content_safety_shield_id: str = Field(
        default="together/meta-llama/Llama-Guard-4-12B",
        description="Default shield id (for inline::llama-guard, this is the model ID)",
    )
    # REMOVED: safety_fail_open - Safety must always fail closed for security.
    # Tests should monkeypatch shields or disable background workflows to avoid external calls.

    # Database Configuration (use psycopg2 driver explicitly)
    database_url: str = "postgresql+psycopg2://myloware:myloware@localhost:5432/myloware"
    db_pool_size: int = Field(default=5, description="Database connection pool size")
    db_max_overflow: int = Field(default=10, description="Database connection pool max overflow")
    async_use_pool: bool = Field(
        default=False,
        description="Use pooled connections for async engine. Disable to force NullPool (safer across event loops).",
    )

    # API Configuration
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_key: str = "dev-api-key"  # Override in production

    # Rate limits (SlowAPI syntax). Defaults tuned for dev/staging; override per env.
    run_rate_limit: str = Field(
        default="60/minute",
        description="Rate limit for /v1/runs/start endpoint (SlowAPI syntax)",
    )
    approve_rate_limit: str = Field(
        default="60/minute",
        description="Rate limit for /v1/runs/{id}/approve endpoints",
    )

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, v: str) -> str:
        """Ensure default API key is not used in production."""
        if os.getenv("ENVIRONMENT") == "production" and v == "dev-api-key":
            raise ValueError("Cannot use default API key in production. Set API_KEY env var.")
        return v

    # External Service API Keys
    brave_api_key: str = Field(
        default="",
        description="Brave Search API key for web search tool",
    )
    openai_api_key: str = ""
    openai_standard_webhook_secret: str = Field(
        default="",
        description="Secret for OpenAI Standard Webhooks (webhook-signature header).",
    )

    remotion_service_url: str = Field(
        default="http://localhost:3001",
        description="Remotion render service URL",
    )
    remotion_webhook_secret: str = Field(
        default="",
        description="Secret for verifying Remotion webhooks",
    )
    openai_sora_signing_secret: str = Field(
        default="",
        description="Secret for verifying OpenAI Sora webhook signatures (HMAC SHA-256)",
    )

    # Render Provider
    render_provider: str = Field(
        default="local",
        description="Render provider type: 'local' (self-hosted Remotion) or 'lambda' (future)",
    )

    # Retrieval / Milvus
    milvus_uri: str = Field(
        default="",
        description="Milvus endpoint (e.g., localhost:19530). Used by retrieval provider/tooling.",
    )

    upload_post_api_key: str = ""
    upload_post_api_url: str = Field(
        default="https://api.upload-post.com",
        description="Upload-Post API base URL (without /api/upload path)",
    )

    # Observability / Alerting
    sentry_dsn: str = Field(
        default="",
        description="Sentry DSN for error monitoring. Leave empty to disable.",
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
    # Sora behavior / provider toggles
    sora_provider: Literal["real", "fake", "off"] = Field(
        default="real",
        description=(
            "Per-provider toggle for OpenAI Sora. "
            "real=call OpenAI, fake=serve local MP4 fixtures via real webhook path, off=disable."
        ),
    )
    sora_fake_clips_dir: str = Field(
        default="fake_clips/sora",
        description="Directory of MP4 fixtures used when SORA_PROVIDER=fake.",
    )
    sora_fake_clip_paths: list[str] = Field(
        default_factory=list,
        description=(
            "Optional explicit MP4 paths for fake Sora provider. "
            "Env var can be comma-separated."
        ),
    )

    @field_validator("sora_fake_clip_paths", mode="before")
    @classmethod
    def _split_sora_fake_clip_paths(cls, v: Any) -> list[str]:
        if v is None or v == "":
            return []
        if isinstance(v, str):
            return [p.strip() for p in v.split(",") if p.strip()]
        return list(v)


    # Remotion provider toggles
    remotion_provider: Literal["real", "fake", "off"] = Field(
        default="real",
        description="Per-provider toggle for Remotion rendering. real=call service, fake=return deterministic stubs, off=disable.",
    )

    # Upload-post provider toggles
    upload_post_provider: Literal["real", "fake", "off"] = Field(
        default="real",
        description="Per-provider toggle for Upload-Post publishing. real=call API, fake=deterministic stubs, off=disable.",
    )

    enable_safety_shields: bool = Field(
        default=True,
        description="Enable content safety shields for write endpoints (always on).",
    )

    # Startup behavior
    fail_fast_on_startup: bool = Field(
        default=True,
        description="Fail startup if critical services (knowledge base, etc.) fail to initialize. "
        "Set to False to allow degraded mode.",
    )

    # Video Cache
    use_video_cache: bool = Field(
        default=False,
        description="Enable video caching - reuse previously generated OpenAI Sora videos",
    )
    cache_new_videos: bool = Field(
        default=True,
        description="Store newly generated videos in cache (requires topic/sign metadata)",
    )

    # Knowledge Base Tuning
    kb_max_file_bytes: int = Field(
        default=512_000,  # 500 KB
        description="Skip knowledge docs larger than this size (bytes)",
    )
    kb_max_total_bytes: int = Field(
        default=50_000_000,  # ~50 MB
        description="Total KB payload cap; extra files are skipped with warning",
    )
    kb_max_docs: int = Field(
        default=500,
        description="Maximum number of documents to ingest per startup",
    )
    kb_parallel_reads: int = Field(
        default=8,
        description="Thread pool size for reading knowledge docs in parallel",
    )
    kb_upload_batch_size: int = Field(
        default=100,
        description="Chunk size for batching KB uploads to the vector store",
    )
    kb_skip_ingest_on_start: bool = Field(
        default=False,
        description="If true, skip KB ingestion at startup (can reload via admin endpoint)",
    )
    kb_chunk_max_chars: int = Field(
        default=2048,  # 512 tokens * 4 chars/token (approximate)
        description="Maximum characters per KB chunk before splitting (target: 512 tokens)",
    )
    kb_chunk_overlap_chars: int = Field(
        default=400,  # 100 tokens * 4 chars/token (approximate)
        description="Character overlap when splitting long KB documents (target: 100 tokens)",
    )

    # Transcode hardening
    transcode_max_concurrency: int = Field(
        default=2, description="Max concurrent ffmpeg transcodes to avoid resource exhaustion."
    )
    transcode_allow_private: bool = Field(
        default=False,
        description="Allow transcoding of URLs that resolve to private/local addresses. Defaults to false for SSRF safety.",
    )
    transcode_allowed_domains: list[str] = Field(
        default_factory=list,
        description="Optional allowlist of hostnames for transcoding; empty means any public host.",
    )

    # Budget / cost guards
    max_runs_last_24h: int = Field(
        default=1000,
        description="Maximum number of runs allowed in the past 24 hours (simple budget guard).",
    )
    daily_cost_budget_usd: float = Field(
        default=200.0,
        description="Daily cost budget for guard checks (rough, per-run estimate).",
    )
    estimated_cost_per_run_usd: float = Field(
        default=0.5,
        description="Estimated cost per run used for budget guard.",
    )

    # Remotion / Render security
    remotion_api_secret: str = Field(
        default="",
        description="Shared secret for signing render requests to the Remotion service",
    )
    remotion_allow_composition_code: bool = Field(
        default=False,
        description="Allow custom composition_code payloads (only enable when sandboxed)",
    )
    remotion_sandbox_enabled: bool = Field(
        default=False,
        description="Indicates render service runs in an isolated sandbox (container/VM with no internal network).",
    )
    disable_background_workflows: bool = Field(
        default=False,
        description="If true, skip enqueueing background workflow execution (useful for fast tests).",
    )

    skip_run_visibility_check: bool = Field(
        default=False,
        description="Skip verifying run visibility after commit (test helper for fake repos).",
    )

    # LangGraph Configuration
    use_langgraph_engine: bool = Field(
        default=True,
        description="Use LangGraph for workflow orchestration.",
    )

    # Circuit Breaker Configuration
    circuit_breaker_enabled: bool = Field(
        default=True,
        description="Enable circuit breaker for Llama Stack client calls.",
    )
    circuit_breaker_failure_threshold: int = Field(
        default=5,
        description="Number of failures before opening circuit.",
    )
    circuit_breaker_recovery_timeout: float = Field(
        default=30.0,
        description="Seconds to wait before attempting recovery (half-open state).",
    )

    @model_validator(mode="after")
    def validate_webhook_url_for_production(self) -> "Settings":
        """Ensure webhook_base_url is set when required by real providers."""
        if (
            self.environment == "production"
            and (self.sora_provider == "real" or self.remotion_provider == "real")
            and not self.webhook_base_url
        ):
            raise ValueError(
                "WEBHOOK_BASE_URL is required when SORA_PROVIDER=real or REMOTION_PROVIDER=real. "
                "Set it to your public API URL (e.g., https://myloware.fly.dev)"
            )
        return self

    @model_validator(mode="after")
    def validate_model(self) -> "Settings":
        """Ensure a model is configured."""
        if not self.llama_stack_model:
            raise ValueError("LLAMA_STACK_MODEL must be configured")
        return self

    @field_validator("enable_safety_shields", mode="before")
    @classmethod
    def force_safety_on(cls, _v: bool) -> bool:
        """Safety shields are always enabled."""
        return True

    # REMOVED: safety_fail_open validator - Safety must always fail closed.

    @field_validator("content_safety_shield_id", mode="before")
    @classmethod
    def force_content_shield(cls, _v: str) -> str:
        """Use the model ID for inline::llama-guard shields."""
        if not _v:
            return "together/meta-llama/Llama-Guard-4-12B"
        return _v

    @field_validator("remotion_allow_composition_code", mode="before")
    @classmethod
    def gate_composition_code(cls, v: bool, info: Any) -> bool:
        """Only allow composition_code when sandboxed or fake providers."""
        data = getattr(info, "data", {}) or {}
        remotion_provider = data.get("remotion_provider", "real")
        sandbox = data.get("remotion_sandbox_enabled", False)
        return bool(v and (sandbox or remotion_provider in {"fake", "off"}))

    # Observability
    log_webhook_payloads: bool = Field(
        default=False,
        description="If true, log raw webhook payloads (may contain sensitive data).",
    )
    log_level: str = "INFO"
    enable_telemetry: bool = True


# Global settings instance
settings = Settings()
