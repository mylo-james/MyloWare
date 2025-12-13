"""FastAPI application for MyloWare API."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Awaitable, Callable
from uuid import uuid4

import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.requests import Request
from fastapi.responses import Response, JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from api.rate_limit import key_api_key_or_ip

from api import routes
from api.middleware.safety import safety_shield_middleware
from api.routes import chat, telegram, webhooks, media, langgraph, admin
from api.routes import metrics as metrics_route
from api.errors import DomainError, to_http_exception
from api.dependencies import verify_api_key, api_key_header
from app_version import get_app_version
from llama_clients import get_sync_client
from config import settings
from knowledge.setup import setup_project_knowledge, get_existing_vector_store
from knowledge.loader import load_documents_with_manifest, load_manifest, save_manifest
from observability.logging import logger, request_id_var
import time
from storage.database import init_db, init_async_db
from prometheus_client import Counter, Histogram
import sentry_sdk

limiter = Limiter(key_func=key_api_key_or_ip)


def _should_init_sentry() -> bool:
    """Guard Sentry initialization in tests/dev to avoid noisy pending-event logs."""
    if not settings.sentry_dsn:
        return False
    if os.getenv("PYTEST_CURRENT_TEST"):
        return False
    if os.getenv("DISABLE_SENTRY", "").lower() in ("1", "true", "yes"):
        return False
    return True


REQUEST_COUNT = Counter(
    "myloware_http_requests_total", "Total HTTP requests", ["method", "path", "status"]
)
REQUEST_LATENCY = Histogram(
    "myloware_http_request_duration_seconds",
    "HTTP request duration in seconds",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
    labelnames=["path"],
)


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    retry_after_header = exc.headers.get("Retry-After") if exc.headers else None
    retry_after = retry_after_header or "60"
    logger.warning(
        "rate_limit_exceeded",
        path=str(request.url.path),
        method=request.method,
        limit=exc.detail,
        request_id=request.headers.get("X-Request-ID"),
    )
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limited",
            "detail": f"Too many requests. Retry after {retry_after} seconds.",
            "retry_after_seconds": int(retry_after) if str(retry_after).isdigit() else retry_after,
            "limit": exc.detail,
        },
        headers=exc.headers or {"Retry-After": str(retry_after)},
    )


def _load_knowledge_documents(project_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Load knowledge docs with filters, hashing, and manifest tracking."""

    prev_manifest = load_manifest()
    docs, manifest = load_documents_with_manifest(
        project_id, include_global=True, read_content=True
    )
    manifest["unchanged"] = bool(
        prev_manifest and prev_manifest.get("hash") == manifest.get("hash")
    )
    save_manifest(manifest)

    doc_dicts = [
        {
            "id": d.id,
            "content": d.content,
            "metadata": {
                **d.metadata,
                "filename": d.filename,
                "type": "knowledge",
            },
        }
        for d in docs
    ]

    return doc_dicts, manifest


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan - setup knowledge base and LangGraph checkpointer on startup."""
    logger.info("Starting MyloWare API...")

    # Optional Sentry instrumentation
    if _should_init_sentry():
        try:
            sentry_sdk.init(dsn=settings.sentry_dsn, traces_sample_rate=0.1, shutdown_timeout=0)
        except Exception as exc:  # tolerates invalid/empty DSN in dev/test
            logger.warning("Sentry initialization skipped: %s", exc)

    # Note: Tracing is handled by Llama Stack's native telemetry
    # We use client.telemetry.log_event() for custom events

    # Track degraded state for health checks
    app.state.knowledge_base_healthy = False
    app.state.knowledge_base_error = None
    app.state.remotion_sandbox_enabled = settings.remotion_sandbox_enabled

    # Ensure database tables exist (supports async + sync drivers)
    try:
        if "aiosqlite" in settings.database_url or "asyncpg" in settings.database_url:
            await init_async_db()
        else:
            init_db()
        app.state.database_ready = True
    except Exception as exc:
        logger.error("Database initialization failed: %s", exc)
        app.state.database_ready = False
        if settings.fail_fast_on_startup:
            raise

    # Initialize LangGraph async checkpointer when using Postgres-backed checkpoints.
    # In SQLite fast-lane/test mode we use an in-memory checkpointer (MemorySaver) and
    # should not attempt to connect AsyncPostgresSaver.
    if settings.use_langgraph_engine and not settings.database_url.startswith("sqlite"):
        try:
            from workflows.langgraph.graph import ensure_checkpointer_initialized

            await ensure_checkpointer_initialized()
            logger.info("LangGraph async checkpointer initialized")
        except Exception as exc:
            logger.error("Failed to initialize LangGraph checkpointer: %s", exc)
            if settings.fail_fast_on_startup:
                raise

    # Skip knowledge base setup when Llama Stack is not real (tests/dev stubs).
    if settings.llama_stack_provider != "real":
        logger.info(
            "Skipping knowledge base setup (LLAMA_STACK_PROVIDER=%s)", settings.llama_stack_provider
        )
        app.state.vector_db_id = f"project_kb_{settings.project_id}"
        app.state.knowledge_base_healthy = True  # Expected in dev mode
        app.state.shields_available = True  # assume dev shields mocked
    else:
        # Setup knowledge base - always auto-discover/create by name
        try:
            client = get_sync_client()
            project_id = settings.project_id
            documents, manifest = _load_knowledge_documents(project_id)
            logger.info(
                "KB scan complete: files=%d, docs_loaded=%d, hash=%s, unchanged=%s",
                len(manifest.get("files", [])),
                len(documents),
                manifest.get("hash"),
                manifest.get("unchanged"),
            )

            store_name = f"project_kb_{project_id}"
            existing_store = get_existing_vector_store(client, store_name)

            if settings.kb_skip_ingest_on_start:
                app.state.vector_db_id = existing_store or store_name
                app.state.knowledge_base_healthy = False
                app.state.knowledge_base_error = "KB ingestion skipped by KB_SKIP_INGEST_ON_START"
                logger.warning(
                    "KB ingestion skipped on start; vector_db_id=%s", app.state.vector_db_id
                )
            else:
                # If unchanged and store exists, skip ingest
                if manifest.get("unchanged") and existing_store:
                    vector_db_id = existing_store
                    logger.info("KB unchanged; reusing existing vector store %s", vector_db_id)
                else:
                    vector_db_id = setup_project_knowledge(
                        client, project_id, documents=documents if documents else None
                    )

                app.state.vector_db_id = vector_db_id
                app.state.knowledge_base_healthy = True
                logger.info("Knowledge base ready: %s (project: %s)", vector_db_id, project_id)

            # Register RAG toolgroup (required for file_search tools)
            try:
                client.toolgroups.register(
                    toolgroup_id="builtin::rag",
                    provider_id="rag-runtime",
                )
                logger.info("Registered RAG toolgroup (rag-runtime)")
            except Exception as rag_exc:
                # RAG is a hard dependency in real environments; fail fast so we don't
                # start in a degraded state with missing file_search tooling.
                error_msg = f"Failed to register RAG toolgroup: {rag_exc}"
                logger.error(error_msg)
                raise RuntimeError(error_msg) from rag_exc

            # Register web search tool if Brave API key is configured
            if settings.brave_api_key:
                try:
                    client.toolgroups.register(
                        toolgroup_id="builtin::websearch",
                        provider_id="brave-search",
                        args={"max_results": 5},
                    )
                    logger.info("Registered web search toolgroup (brave-search)")
                except Exception as tool_exc:
                    logger.warning("Failed to register web search toolgroup: %s", tool_exc)
            else:
                logger.info("Skipping web search toolgroup (BRAVE_API_KEY not set)")

            # Safety shields are registered in llama_stack/run-milvus.yaml
            # Just verify they're available
            try:
                shields = client.shields.list()
                shield_list = shields.data if hasattr(shields, "data") else []
                expected_shield_id = settings.content_safety_shield_id
                content_safety_exists = any(s.identifier == expected_shield_id for s in shield_list)
                if content_safety_exists:
                    logger.info(
                        "Safety shield available: %s (registered in YAML)", expected_shield_id
                    )
                    app.state.shields_available = True
                else:
                    logger.warning("Safety shield not found: %s", expected_shield_id)
                    app.state.shields_available = False
            except Exception as shield_exc:
                logger.warning("Failed to check safety shields: %s", shield_exc)
                app.state.shields_available = False

        except Exception as exc:
            error_msg = f"Knowledge base setup failed: {exc}"
            logger.error(error_msg)
            app.state.vector_db_id = f"project_kb_{settings.project_id}"
            app.state.knowledge_base_error = error_msg

            # RAG is mandatory outside of fake-provider mode; never continue degraded.
            raise RuntimeError(error_msg) from exc

    yield

    logger.info("Shutting down MyloWare API...")

    # Cleanup LangGraph async checkpointer
    if settings.use_langgraph_engine:
        try:
            from workflows.langgraph.graph import _exit_async_checkpointer

            await _exit_async_checkpointer()
            logger.info("LangGraph async checkpointer closed")
        except Exception as exc:
            logger.warning("Error closing LangGraph checkpointer: %s", exc)


app = FastAPI(
    title="MyloWare API",
    description="Llama Stack-native multi-agent video production platform",
    version=get_app_version(),
    lifespan=lifespan,
)

app.middleware("http")(safety_shield_middleware)


@app.middleware("http")
async def request_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Middleware to manage X-Request-ID header and contextvar propagation."""

    incoming_request_id = request.headers.get("X-Request-ID")
    request_id = incoming_request_id or str(uuid4())

    token = request_id_var.set(request_id)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)

    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def timing_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    try:
        REQUEST_COUNT.labels(
            method=request.method,
            path=str(request.url.path),
            status=response.status_code,
        ).inc()
        REQUEST_LATENCY.labels(path=str(request.url.path)).observe(duration_ms / 1000.0)
    except Exception:  # pragma: no cover - metrics should not break requests
        pass
    logger.info(
        "request_complete",
        path=str(request.url.path),
        method=request.method,
        status=response.status_code,
        duration_ms=round(duration_ms, 2),
        request_id=request.headers.get("X-Request-ID"),
    )
    response.headers["X-Response-Time-ms"] = f"{duration_ms:.2f}"
    return response


# Add rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Return consistent error envelope."""
    detail = exc.detail
    if isinstance(detail, dict):
        error_code = detail.get("error", "http_error")
    else:
        error_code = "http_error"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": error_code,
            "detail": detail,
        },
        headers=exc.headers,
    )


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    http_exc = to_http_exception(exc)
    return await http_exception_handler(request, http_exc)


# Include routers
auth_deps = [Depends(verify_api_key)]
app.include_router(routes.health.router)  # Health check is public (for Docker/K8s)
app.include_router(routes.runs.router, prefix="/v1/runs", dependencies=auth_deps)
app.include_router(routes.feedback.router, prefix="/v1", dependencies=auth_deps)
app.include_router(chat.router, dependencies=auth_deps)
app.include_router(telegram.router)
app.include_router(webhooks.router)
app.include_router(media.router)
app.include_router(langgraph.router, dependencies=auth_deps)  # LangGraph v2 API
app.include_router(admin.router)  # Admin endpoints (already has auth_deps)
app.include_router(metrics_route.router)


__all__ = ["app", "verify_api_key", "api_key_header", "limiter"]
