from __future__ import annotations

import logging

from fastapi import FastAPI

from .logging_filters import install_info_sampling_filter
from .metrics import setup_metrics
from .sentry import setup_sentry as _setup_sentry


def setup_observability(
    app: FastAPI,
    *,
    service_name: str,
    environment: str,
    version: str,
    sentry_dsn: str | None,
) -> None:
    """One-stop observability bootstrap for services (MVP).

    MVP scope:
    - Structured logging with optional INFO-level sampling in production.

    Prometheus metrics, distributed tracing, and Sentry wiring are intentionally
    omitted from the MVP dependency set; they can be reintroduced later without
    changing service call-sites.
    """
    # Attach a sampling filter so INFO logs are reduced in production
    # without affecting local/staging environments.
    root_logger = logging.getLogger()
    # Ensure INFO-level service logs (like persona prompt loading) remain visible
    # during local/staging development. Production sampling is handled by the
    # filter below, so setting the base level to INFO keeps diagnostics intact.
    if root_logger.level > logging.INFO:
        root_logger.setLevel(logging.INFO)
    install_info_sampling_filter(environment)
    # Attach HTTP metrics and the Prometheus /metrics endpoint.
    setup_metrics(app, service_name=service_name)
    # Enable Sentry only when a DSN + SDK are present.
    _setup_sentry(dsn=sentry_dsn, environment=environment, version=version)


__all__ = ["setup_observability", "install_info_sampling_filter"]
