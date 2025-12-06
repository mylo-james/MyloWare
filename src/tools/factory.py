"""Factory for creating tool clients (real or fake)."""

from __future__ import annotations

from config import settings
from tools.fakes import (
    KIEFakeClient,
    RemotionFakeClient,
    UploadPostFakeClient,
)

__all__ = [
    "get_kie_client",
    "get_remotion_client",
    "get_upload_post_client",
]


def get_kie_client():
    """Return KIE client or fake based on settings."""

    if settings.use_fake_providers:
        return KIEFakeClient()
    # Real client not implemented; raise to avoid silent use
    raise NotImplementedError("Real KIE client creation not implemented")


def get_remotion_client():
    """Return Remotion client or fake based on settings."""

    if settings.use_fake_providers:
        return RemotionFakeClient()
    raise NotImplementedError("Real Remotion client creation not implemented")


def get_upload_post_client():
    """Return upload-post client or fake based on settings."""

    if settings.use_fake_providers:
        return UploadPostFakeClient()
    raise NotImplementedError("Real Upload-Post client creation not implemented")
