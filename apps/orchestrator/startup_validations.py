"""Additional startup validations for the orchestrator service.

These checks enforce adapter host allowlists early in the boot sequence so
misconfigured provider base URLs fail fast instead of surfacing only when a
persona tool is first invoked.
"""
from __future__ import annotations

import logging
from typing import Iterable
from urllib.parse import urlparse

from adapters.security.host_allowlist import ensure_host_allowed

from .config import Settings

logger = logging.getLogger("myloware.orchestrator.startup_validations")


_KIEAI_ALLOWED_HOSTS: list[str] = [
    "api.kie.ai",
    "staging-api.kie.ai",
]

_SHOTSTACK_ALLOWED_HOSTS: list[str] = [
    "api.shotstack.io",
    "api.shotstack.com",
]

_UPLOAD_POST_ALLOWED_HOSTS: list[str] = [
    "api.upload-post.com",
    "api.upload-post.dev",
    "upload-post.myloware.com",
]


def _extract_host(url: str) -> str:
    parsed = urlparse(url or "")
    return parsed.hostname or ""


def _validate_single_host(host: str, allowed: Iterable[str], *, component: str, allow_dev_hosts: bool) -> None:
    """Helper that delegates to ``ensure_host_allowed`` with logging.

    This keeps the validations aligned with the adapter-level checks in
    ``adapters.security.host_allowlist`` while providing a clear component
    label for error messages.
    """

    ensure_host_allowed(
        host,
        allowed_hosts=list(allowed),
        component=component,
        allow_dev_hosts=allow_dev_hosts,
    )


def validate_adapter_hosts(settings: Settings) -> None:
    """Validate provider base URLs against their host allowlists.

    This is intended to be called from startup in strict modes (staging/prod
    or when ``STRICT_STARTUP_CHECKS=1``) so that any misconfigured provider
    URLs cause an immediate, loud failure instead of a deferred runtime error.
    """

    env = str(getattr(settings, "environment", "local")).lower()
    allow_dev_hosts = env in {"local", "dev"}

    logger.info(
        "Validating adapter hosts",
        extra={"environment": env, "allow_dev_hosts": allow_dev_hosts},
    )

    kie_host = _extract_host(getattr(settings, "kieai_base_url", ""))
    _validate_single_host(
        kie_host,
        _KIEAI_ALLOWED_HOSTS,
        component="KieAIClient base_url (startup)",
        allow_dev_hosts=allow_dev_hosts,
    )

    shotstack_host = _extract_host(getattr(settings, "shotstack_base_url", ""))
    _validate_single_host(
        shotstack_host,
        _SHOTSTACK_ALLOWED_HOSTS,
        component="ShotstackClient base_url (startup)",
        allow_dev_hosts=allow_dev_hosts,
    )

    upload_post_host = _extract_host(getattr(settings, "upload_post_base_url", ""))
    _validate_single_host(
        upload_post_host,
        _UPLOAD_POST_ALLOWED_HOSTS,
        component="UploadPostClient base_url (startup)",
        allow_dev_hosts=allow_dev_hosts,
    )

    logger.info("Adapter host validations passed", extra={"environment": env})


__all__ = ["validate_adapter_hosts"]

