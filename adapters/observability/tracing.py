from __future__ import annotations

from typing import Optional

from fastapi import FastAPI


def setup_tracing(
    app: FastAPI,
    *,
    service_name: str,
    environment: str,
    version: str,
) -> None:  # pragma: no cover - MVP no-op
    """Placeholder for future distributed tracing setup.

    The MVP removes tracing dependencies; this function remains so that
    call-sites do not need to change when tracing is reintroduced later.
    """
    return None
