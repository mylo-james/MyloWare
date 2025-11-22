"""Factory for Shotstack adapter selection."""
from __future__ import annotations

from typing import Protocol

from adapters.ai_providers.shotstack.client import ShotstackClient
from adapters.ai_providers.shotstack.fake import ShotstackFakeClient
from adapters.persistence.cache import ResponseCache


class _ShotstackSettings(Protocol):
    providers_mode: str
    shotstack_api_key: str
    shotstack_base_url: str
    environment: str


def get_shotstack_client(
    settings: _ShotstackSettings,
    *,
    cache: ResponseCache | None = None,
    poll_interval: float = 2.0,
    poll_timeout: float = 120.0,
) -> ShotstackFakeClient | ShotstackClient:
    mode = str(getattr(settings, "providers_mode", "mock")).lower()
    if mode == "mock":
        return ShotstackFakeClient()

    env = str(getattr(settings, "environment", "local")).lower()
    allow_dev_hosts = env in {"local", "dev"}

    # In staging/production, Shotstack renders can legitimately take longer than
    # local mocks. Give them more time before timing out so Alex can reliably
    # capture the final S3 URL as a render.url artifact.
    effective_timeout = poll_timeout
    if mode != "mock" and env in {"staging", "prod", "production"}:
        effective_timeout = max(poll_timeout, 300.0)

    return ShotstackClient(
        api_key=settings.shotstack_api_key,
        base_url=settings.shotstack_base_url,
        cache=cache,
        allow_dev_hosts=allow_dev_hosts,
        poll_interval=poll_interval,
        poll_timeout=effective_timeout,
    )


__all__ = ["get_shotstack_client", "ShotstackFakeClient", "ShotstackClient"]
