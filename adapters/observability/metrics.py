from __future__ import annotations

import time
from typing import Any

from fastapi import FastAPI, Request
from prometheus_client import Counter, Histogram, make_asgi_app
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp


_HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests processed by the service",
    ["service", "method", "path", "status"],
)

_HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["service", "method", "path", "status"],
    buckets=(0.05, 0.1, 0.2, 0.5, 1, 2, 5),
)


class _HTTPMetricsMiddleware(BaseHTTPMiddleware):
    """Record basic HTTP metrics (method, path, status, duration)."""

    def __init__(self, app: ASGIApp, *, service_name: str) -> None:
        super().__init__(app)
        self._service_name = service_name

    async def dispatch(self, request: Request, call_next) -> Any:  # type: ignore[override]
        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start

        path = request.url.path or "/"
        method = request.method
        status = getattr(response, "status_code", 500)

        labels = {
            "service": self._service_name,
            "method": method,
            "path": path,
            "status": str(status),
        }

        try:
            _HTTP_REQUESTS_TOTAL.labels(**labels).inc()
            _HTTP_REQUEST_DURATION_SECONDS.labels(**labels).observe(duration)
        except Exception:
            # Metrics must never break request handling.
            pass

        return response


def setup_metrics(app: FastAPI, *, service_name: str) -> None:
    """Attach HTTP metrics middleware and mount the Prometheus /metrics endpoint.

    This uses the official prometheus_client ASGI app as the single source of
    truth for metrics scraping and keeps HTTP instrumentation intentionally
    lightweight.
    """

    # Only mount /metrics once per process.
    if not any(getattr(route, "path", None) == "/metrics" for route in app.router.routes):
        app.mount("/metrics", make_asgi_app())

    # Avoid installing duplicate middleware when called multiple times.
    if getattr(app.state, "_http_metrics_installed", False):
        return

    app.add_middleware(_HTTPMetricsMiddleware, service_name=service_name)
    app.state._http_metrics_installed = True
