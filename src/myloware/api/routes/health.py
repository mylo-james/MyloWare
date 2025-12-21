"""Health check endpoints."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request, Query

from myloware.app_version import get_app_version
from myloware.api.schemas import HealthResponse
from fastapi.responses import JSONResponse
from sqlalchemy import text

from myloware.config.settings import settings
from myloware.llama_clients import _get_circuit_breaker
from myloware.observability.logging import get_logger
from myloware.workflows.langgraph.graph import check_checkpointer_health

router = APIRouter(tags=["Health"])
logger = get_logger(__name__)


@router.get("/health", response_model=HealthResponse)
async def health_check(
    request: Request, deep: bool = Query(False, description="If true, also ping Llama Stack")
) -> dict[str, Any]:
    """Health check endpoint."""

    provider_modes = {
        "llama_stack": settings.llama_stack_provider,
        "sora": settings.sora_provider,
        "remotion": settings.remotion_provider,
        "upload_post": settings.upload_post_provider,
    }
    degraded_mode = any(mode != "real" for mode in provider_modes.values())
    # /health is a liveness probe; report degraded state separately.
    status = "healthy"

    # Get circuit breaker state
    circuit_breaker_state = None
    if settings.circuit_breaker_enabled:
        cb = _get_circuit_breaker()
        if cb:
            circuit_breaker_state = cb.state.value

    payload = {
        "status": status,
        "version": get_app_version(),
        "degraded_mode": degraded_mode,
        "provider_modes": provider_modes,
        "knowledge_base_healthy": getattr(request.app.state, "knowledge_base_healthy", None),
        "shields_available": getattr(request.app.state, "shields_available", None),
        "vector_db_id": getattr(request.app.state, "vector_db_id", None),
        "render_sandbox_enabled": getattr(request.app.state, "remotion_sandbox_enabled", None),
        "llama_stack_circuit": circuit_breaker_state,
    }

    if deep:
        from myloware.llama_clients import get_async_client, list_models_async

        try:
            if provider_modes["llama_stack"] != "real":
                raise RuntimeError(f"LLAMA_STACK_PROVIDER={provider_modes['llama_stack']}")
            models = await list_models_async(get_async_client())
            payload["llama_stack_reachable"] = True
            payload["llama_stack_models"] = models[:5]
        except Exception as exc:
            payload["llama_stack_reachable"] = False
            payload["llama_stack_error"] = str(exc)

    return payload


@router.get("/health/langgraph")
async def langgraph_health(request: Request) -> JSONResponse:
    """Check LangGraph checkpointer connectivity."""
    engine = getattr(request.app.state, "langgraph_engine", None)
    ok = await check_checkpointer_health(engine)
    status_code = 200 if ok else 503
    return JSONResponse(
        content={"langgraph_checkpointer": "healthy" if ok else "unhealthy"},
        status_code=status_code,
    )


@router.get("/health/db")
async def db_health_check() -> JSONResponse:
    """Check database connectivity and migration status.

    Returns 200 if database is healthy, 503 otherwise.
    """
    from myloware.storage.database import get_engine

    checks: Dict[str, Any] = {"database": "unknown"}
    status_code = 200

    try:
        # Check database connectivity
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            checks["database"] = "healthy"
    except Exception as exc:
        logger.error("Database health check failed: %s", exc)
        checks["database"] = "unhealthy"
        checks["database_error"] = str(exc)
        status_code = 503

    # Optionally check migration status
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        from alembic.runtime.migration import MigrationContext

        engine = get_engine()
        with engine.connect() as conn:
            context = MigrationContext.configure(conn)
            current_rev = context.get_current_revision()

            alembic_cfg = Config("alembic.ini")
            script = ScriptDirectory.from_config(alembic_cfg)
            head_rev = script.get_current_head()

            checks["migration_current"] = current_rev
            checks["migration_head"] = head_rev
            checks["migrations_up_to_date"] = current_rev == head_rev

            if current_rev != head_rev:
                checks["migration_status"] = "migrations_pending"
    except Exception as exc:
        # Migration check is optional - don't fail health check
        logger.debug("Migration status check skipped: %s", exc)
        checks["migration_status"] = "check_skipped"

    return JSONResponse(content=checks, status_code=status_code)


@router.get("/health/stuck-runs")
async def get_stuck_runs_endpoint(
    timeout_minutes: int = 60,
) -> Dict[str, Any]:
    """Get runs that appear stuck in waiting states.

    Args:
        timeout_minutes: Minutes after which a waiting run is considered stuck

    Returns:
        Dict with stuck run details
    """
    from myloware.workflows.cleanup import get_stuck_runs

    stuck = get_stuck_runs(timeout_minutes=timeout_minutes)
    return {
        "timeout_minutes": timeout_minutes,
        "stuck_runs": stuck,
        "count": len(stuck),
    }


@router.post("/health/cleanup-stuck-runs")
async def cleanup_stuck_runs_endpoint(
    timeout_minutes: int = 60,
    dry_run: bool = True,
) -> Dict[str, Any]:
    """Timeout stuck runs that have been waiting too long.

    Args:
        timeout_minutes: Minutes after which a waiting run is considered stuck
        dry_run: If True (default), only report what would be done

    Returns:
        Dict with cleanup results
    """
    from myloware.workflows.cleanup import timeout_stuck_runs

    timed_out = timeout_stuck_runs(timeout_minutes=timeout_minutes, dry_run=dry_run)
    return {
        "timeout_minutes": timeout_minutes,
        "dry_run": dry_run,
        "timed_out_run_ids": [str(rid) for rid in timed_out],
        "count": len(timed_out),
    }


@router.get("/health/full")
async def full_health_check(request: "Request") -> JSONResponse:
    """Comprehensive health check including all dependencies.

    Returns 200 if all services are healthy, 503 if any are unhealthy.
    Exposes degraded state (e.g., knowledge base failures) for monitoring.
    """
    import httpx
    from myloware.storage.database import get_engine

    provider_modes = {
        "llama_stack": settings.llama_stack_provider,
        "sora": settings.sora_provider,
        "remotion": settings.remotion_provider,
        "upload_post": settings.upload_post_provider,
    }
    degraded_mode = any(mode != "real" for mode in provider_modes.values())
    all_healthy = not degraded_mode  # Degraded mode means not fully healthy

    # Get circuit breaker state
    circuit_breaker_state = None
    if settings.circuit_breaker_enabled:
        cb = _get_circuit_breaker()
        if cb:
            circuit_breaker_state = cb.state.value
            # Circuit open means unhealthy
            if cb.state.value == "open":
                all_healthy = False

    checks: Dict[str, Any] = {
        "api": "healthy",
        "version": get_app_version(),
        "degraded_mode": degraded_mode,
        "provider_modes": provider_modes,
        "database": "unknown",
        "llama_stack": "unknown",
        "safety_shield": "unknown",
        "knowledge_base": "unknown",
        "llama_stack_circuit": circuit_breaker_state,
    }

    # Check database
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            checks["database"] = "healthy"
    except Exception as exc:
        logger.error("Database health check failed: %s", exc)
        checks["database"] = "unhealthy"
        all_healthy = False

    # Check Llama Stack connectivity
    # If circuit breaker is open, skip connectivity check (it will fail anyway)
    if circuit_breaker_state == "open":
        checks["llama_stack"] = "circuit_open"
        all_healthy = False
    else:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{settings.llama_stack_url}/health")
                if response.status_code == 200:
                    checks["llama_stack"] = "healthy"
                else:
                    checks["llama_stack"] = "unhealthy"
                    all_healthy = False
        except Exception as exc:
            logger.error("Llama Stack health check failed: %s", exc)
            checks["llama_stack"] = "unreachable"
            all_healthy = False

    # Check that configured content safety shield exists and is served
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            shield_id = settings.content_safety_shield_id
            resp = await client.get(f"{settings.llama_stack_url}/v1/shields/{shield_id}")
            if resp.status_code == 200:
                checks["safety_shield"] = "healthy"
            else:
                checks["safety_shield"] = f"unhealthy({resp.status_code})"
                all_healthy = False
    except Exception as exc:
        logger.error("Safety shield health check failed: %s", exc)
        checks["safety_shield"] = "unreachable"
        all_healthy = False

    # Check knowledge base state (set during startup lifespan)
    # Access via request.app.state if available
    try:
        # This is injected by FastAPI when the endpoint is called
        if hasattr(request, "app") and hasattr(request.app, "state"):
            app_state = request.app.state
            kb_healthy = getattr(app_state, "knowledge_base_healthy", None)
            kb_error = getattr(app_state, "knowledge_base_error", None)

            if kb_healthy is True:
                checks["knowledge_base"] = "healthy"
            elif kb_healthy is False:
                checks["knowledge_base"] = "degraded"
                checks["knowledge_base_error"] = kb_error
                # Degraded KB doesn't fail health check, but is visible for monitoring
                logger.warning("Knowledge base in degraded state: %s", kb_error)
            else:
                checks["knowledge_base"] = "unknown"
        else:
            checks["knowledge_base"] = "not_checked"
    except Exception as exc:
        logger.debug("Could not check knowledge base state: %s", exc)
        checks["knowledge_base"] = "check_failed"

    status_code = 200 if all_healthy else 503
    return JSONResponse(content=checks, status_code=status_code)


__all__ = ["router"]
