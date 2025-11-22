"""Factory for upload-post adapter selection."""
from __future__ import annotations

from typing import Protocol

from adapters.persistence.cache import ResponseCache
from adapters.social.upload_post.client import UploadPostClient
from adapters.social.upload_post.fake import UploadPostFakeClient


class _UploadPostSettings(Protocol):
    providers_mode: str
    upload_post_api_key: str
    upload_post_base_url: str
    upload_post_signing_secret: str
    environment: str


def get_upload_post_client(
    settings: _UploadPostSettings,
    *,
    cache: ResponseCache | None = None,
) -> UploadPostFakeClient | UploadPostClient:
    mode = str(getattr(settings, "providers_mode", "mock")).lower()
    if mode == "mock":
        return UploadPostFakeClient()

    allow_dev_hosts = str(getattr(settings, "environment", "local")).lower() in {"local", "dev"}

    return UploadPostClient(
        api_key=settings.upload_post_api_key,
        base_url=settings.upload_post_base_url,
        signing_secret=settings.upload_post_signing_secret,
        cache=cache,
        allow_dev_hosts=allow_dev_hosts,
    )


__all__ = ["get_upload_post_client", "UploadPostFakeClient", "UploadPostClient"]
