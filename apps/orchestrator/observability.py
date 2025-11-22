"""Observability helpers for the orchestrator service (delegates to adapters)."""
from __future__ import annotations

from fastapi import FastAPI

from adapters.observability import setup_observability as _setup
from .config import Settings


def setup_observability(app: FastAPI, settings: Settings) -> None:
    _setup(
        app,
        service_name="myloware-orchestrator",
        environment=settings.environment,
        version=settings.version,
        sentry_dsn=settings.sentry_dsn,
    )
