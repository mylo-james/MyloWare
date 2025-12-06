"""Health check endpoints."""

from __future__ import annotations

import logging
from importlib.metadata import version
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from config.settings import settings

router = APIRouter(tags=["Health"])
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check():
    """Health check endpoint."""

    return {"status": "healthy", "version": version("myloware")}


@router.get("/health/db")
async def db_health_check() -> JSONResponse:
    """Check database connectivity and migration status.
    
    Returns 200 if database is healthy, 503 otherwise.
    """
    from storage.database import get_engine
    
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


@router.get("/health/full")
async def full_health_check() -> JSONResponse:
    """Comprehensive health check including all dependencies.
    
    Returns 200 if all services are healthy, 503 if any are unhealthy.
    """
    import httpx
    from storage.database import get_engine
    
    checks: Dict[str, Any] = {
        "api": "healthy",
        "version": version("myloware"),
        "database": "unknown",
        "llama_stack": "unknown",
    }
    all_healthy = True
    
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
    
    status_code = 200 if all_healthy else 503
    return JSONResponse(content=checks, status_code=status_code)


__all__ = ["router"]
