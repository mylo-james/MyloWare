"""Dependency injection helpers for FastAPI."""
from __future__ import annotations

from functools import lru_cache

from adapters.persistence.cache import ResponseCache
from adapters.ai_providers.kieai.client import KieAIClient
from adapters.ai_providers.kieai.factory import get_kieai_client as build_kieai_client
from adapters.social.upload_post.client import UploadPostClient
from adapters.social.upload_post.factory import get_upload_post_client as build_upload_post_client
from adapters.orchestration.mcp_client import MCPClient

from .config import get_settings, settings
from .orchestrator_client import OrchestratorClient
from .services.test_video_gen import VideoGenService
from .storage import Database


@lru_cache(maxsize=1)
def get_database() -> Database:
    return Database(settings.db_url)


@lru_cache(maxsize=1)
def get_provider_cache() -> ResponseCache:
    return ResponseCache(settings.provider_cache_dir)


@lru_cache(maxsize=1)
def get_kieai_client() -> KieAIClient:
    return build_kieai_client(settings, cache=get_provider_cache())


@lru_cache(maxsize=1)
def get_upload_post_client() -> UploadPostClient:
    return build_upload_post_client(settings, cache=get_provider_cache())


@lru_cache(maxsize=1)
def get_orchestrator_client() -> OrchestratorClient:
    return OrchestratorClient(base_url=settings.orchestrator_base_url, api_key=settings.api_key)


@lru_cache(maxsize=1)
def get_mcp_client() -> MCPClient:
    return MCPClient(base_url=settings.mcp_base_url, api_key=settings.mcp_api_key)


@lru_cache(maxsize=1)
def get_video_gen_service() -> VideoGenService:
    return VideoGenService(
        db=get_database(),
        kieai=get_kieai_client(),
        upload_post=get_upload_post_client(),
        orchestrator=get_orchestrator_client(),
        mcp=get_mcp_client(),
        webhook_base_url=settings.webhook_base_url,
        settings=get_settings(),
        kieai_model=getattr(settings, "kieai_model", "veo3_fast"),
        kieai_default_duration=getattr(settings, "kieai_default_duration", 5),
        kieai_default_quality=getattr(settings, "kieai_default_quality", "720p"),
        kieai_default_aspect_ratio=getattr(settings, "kieai_default_aspect_ratio", "16:9"),
        publish_on_clip_webhook=True,
    )
