"""Factory for kie.ai adapters (real vs fake)."""
from __future__ import annotations

from typing import Protocol

from adapters.ai_providers.kieai.client import KieAIClient
from adapters.ai_providers.kieai.fake import KieAIFakeClient
from adapters.persistence.cache import ResponseCache


class _KieAISettings(Protocol):
    providers_mode: str
    kieai_api_key: str
    kieai_base_url: str
    kieai_signing_secret: str
    environment: str


def get_kieai_client(
    settings: _KieAISettings,
    *,
    cache: ResponseCache | None = None,
) -> KieAIFakeClient | KieAIClient:
    """Return a deterministic fake when in mock mode, otherwise a real client."""

    mode = str(getattr(settings, "providers_mode", "mock")).lower()
    if mode != "live":
        return KieAIFakeClient()

    allow_dev_hosts = str(getattr(settings, "environment", "local")).lower() in {"local", "dev"}

    signing_secret = getattr(settings, "kieai_signing_secret", None)
    if not signing_secret:
        signing_secret = ""

    return KieAIClient(
        api_key=settings.kieai_api_key,
        base_url=settings.kieai_base_url,
        signing_secret=signing_secret,
        cache=cache,
        allow_dev_hosts=allow_dev_hosts,
    )


__all__ = ["get_kieai_client", "KieAIFakeClient", "KieAIClient"]
