"""Startup preflight checks for the orchestrator service."""
from __future__ import annotations

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine
from fastapi import FastAPI

from .config import Settings
from . import persona_nodes
from .startup_validations import validate_adapter_hosts
from .langgraph_checkpoint import close_graph_checkpointer

logger = logging.getLogger("uvicorn.error")


async def check_db_connectivity(dsn: str) -> None:
    """Verify database connectivity."""
    try:
        normalized_dsn = dsn.replace("postgresql+psycopg", "postgresql", 1)
        conn = psycopg.connect(normalized_dsn, autocommit=True)
        conn.execute("SELECT 1")
        conn.close()
        logger.info("Database connectivity check passed")
    except Exception as exc:
        logger.error("Database connectivity check failed", exc_info=exc)
        raise


def check_migrations_current(dsn: str) -> None:
    """Verify migrations are current."""
    try:
        # Keep postgresql+psycopg for SQLAlchemy to use psycopg3
        engine = create_engine(dsn)
        with engine.connect() as conn:
            context = MigrationContext.configure(conn)
            current_rev = context.get_current_revision()
            alembic_cfg = Config("alembic.ini")
            script = ScriptDirectory.from_config(alembic_cfg)
            head_rev = script.get_current_head()
            if current_rev != head_rev:
                logger.error(
                    "Migrations not current",
                    extra={"current": current_rev, "head": head_rev},
                )
                raise ValueError(f"Migrations not current: current={current_rev}, head={head_rev}")
        logger.info("Migrations check passed", extra={"current": current_rev})
        engine.dispose()
    except Exception as exc:
        logger.error("Migrations check failed", exc_info=exc)
        raise


async def _ensure_metrics_endpoint(app: FastAPI | None, strict: bool) -> None:
    if not strict:
        return
    if app is None:
        raise RuntimeError("Metrics endpoint verification requires a FastAPI app when strict startup checks are enabled")
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://startup-check", follow_redirects=True) as client:
            response = await client.get("/metrics")
    except Exception as exc:
        logger.error("Metrics endpoint probe failed", exc_info=exc)
        raise RuntimeError("Metrics endpoint probe failed") from exc
    if response.status_code != 200:
        raise RuntimeError(f"Metrics endpoint returned unexpected status {response.status_code}")


async def run_preflight_checks(settings: Settings, app: FastAPI | None = None) -> None:
    """Run all startup preflight checks."""
    logger.info("Running startup preflight checks")
    await check_db_connectivity(settings.db_url)
    environment = str(settings.environment).lower()
    strict = environment in {"staging", "prod"} or bool(
        getattr(settings, "strict_startup_checks", False),
    )
    if strict:
        check_migrations_current(settings.db_url)
        validate_adapter_hosts(settings)
    else:
        try:
            check_migrations_current(settings.db_url)
        except Exception as exc:
            logger.warning(
                "Migrations check failed in non-strict mode; continuing startup",
                exc_info=exc,
            )
    await _ensure_metrics_endpoint(app, strict)
    logger.info("All preflight checks passed")


@asynccontextmanager
async def lifespan(app: object) -> AsyncIterator[None]:
    """FastAPI lifespan context manager for startup/shutdown."""
    from .config import get_settings
    settings = get_settings()

    try:
        fastapi_app = app if isinstance(app, FastAPI) else None
        await run_preflight_checks(settings, app=fastapi_app)
        _log_langchain_runtime_configuration(settings)
        yield
    except Exception as exc:
        logger.critical("Preflight checks failed, exiting", exc_info=exc)
        sys.exit(1)
    finally:
        try:
            close_graph_checkpointer()
        except Exception:  # pragma: no cover - defensive
            logger.warning("Failed to close LangGraph checkpointer during shutdown", exc_info=True)


def _log_langchain_runtime_configuration(settings: Settings) -> None:
    """Log whether LangChain personas are active for this process."""
    langchain_available = bool(getattr(persona_nodes, "LANGCHAIN_AVAILABLE", False))
    enable_langchain_personas = bool(getattr(settings, "enable_langchain_personas", False))
    providers_mode = getattr(settings, "providers_mode", "mock")
    environment = getattr(settings, "environment", "local")
    logger.info(
        "LangChain persona runtime configuration | langchain_available=%s enable_langchain_personas=%s providers_mode=%s environment=%s",
        langchain_available,
        enable_langchain_personas,
        providers_mode,
        environment,
    )
