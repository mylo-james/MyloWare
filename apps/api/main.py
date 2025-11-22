"""FastAPI entrypoint for the orchestration platform."""
from __future__ import annotations

from datetime import UTC, datetime
from fastapi import Depends, FastAPI

from .auth import verify_api_key
from .config import get_settings
from .middleware import APIKeyMiddleware
from adapters.observability.request_id import RequestIDMiddleware, get_request_id
from .observability import setup_observability
from .routes import runs, webhooks, hitl, notifications, projects, artifacts, chat
from .integrations import telegram as telegram_integration
from .startup import lifespan

settings = get_settings()

app = FastAPI(
    title="MyloWare API",
    version=settings.version,
    description="API gateway for the MyloWare LangGraph orchestration platform.",
    lifespan=lifespan,
)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    APIKeyMiddleware,
    settings=settings,
    exempt_paths={"/health", "/metrics"},
    exempt_prefixes=("/docs", "/openapi.json", "/redoc", "/v1/webhooks", "/v1/telegram"),
)
setup_observability(app, settings)
app.include_router(runs.router)
app.include_router(webhooks.router)
app.include_router(hitl.router)
app.include_router(notifications.router)
app.include_router(projects.router)
app.include_router(artifacts.router)
app.include_router(telegram_integration.router)
app.include_router(chat.router)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Simple liveness probe used by Docker Compose and Grafana."""

    return {
        "status": "ok",
        "timestamp": datetime.now(UTC).isoformat(),
        "request_id": get_request_id(),
    }


@app.get("/version", dependencies=[Depends(verify_api_key)], tags=["system"])
async def version() -> dict[str, str]:
    """Protected endpoint that returns deployment metadata."""

    return {
        "version": settings.version,
        "environment": settings.environment,
        "request_id": get_request_id(),
    }


@app.get("/v1/ping", dependencies=[Depends(verify_api_key)], tags=["system"])
async def ping() -> dict[str, str]:
    """Simple authenticated ping endpoint used during smoke tests."""

    return {"message": "pong", "request_id": get_request_id()}
