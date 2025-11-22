"""Startup preflight checks for the API service."""
from __future__ import annotations

import logging
import subprocess
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI

import psycopg
from adapters.persistence.cache.redis import is_available as redis_available, ping as redis_ping

from .config import Settings

logger = logging.getLogger("myloware.api.startup")


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


async def check_redis_connectivity(redis_url: str) -> None:
    """Verify Redis connectivity."""
    if not redis_available():
        logger.warning("Redis not available, skipping connectivity check")
        return
    try:
        await redis_ping(redis_url)
        logger.info("Redis connectivity check passed")
    except Exception as exc:
        logger.error("Redis connectivity check failed", exc_info=exc)
        raise


def check_migrations_current(dsn: str) -> None:
    """Verify migrations are current."""
    try:
        from sqlalchemy import create_engine
        from alembic.config import Config
        from alembic.runtime.migration import MigrationContext
        from alembic.script import ScriptDirectory

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
    except ModuleNotFoundError as missing:
        logger.warning(
            "Skipping migration check; dependency missing",
            extra={"error": str(missing)},
        )
        return
    except Exception as exc:
        logger.error("Migrations check failed", exc_info=exc)
        raise


def _run_alembic_upgrade_head() -> None:
    """Run Alembic migrations to head in strict environments.

    This is primarily used in staging/prod when no Alembic revision exists yet
    (e.g. a fresh database) so that strict startup checks can still be enforced
    without requiring a separate manual migration step.
    """
    try:
        logger.info("Running Alembic migrations to head for strict environment")
        # Default working directory in the container is /app, but be explicit.
        root = Path("/app")
        subprocess.run(
            ["alembic", "upgrade", "head"],
            check=True,
            cwd=root,
        )
        logger.info("Alembic migrations to head completed successfully")
    except Exception as exc:  # pragma: no cover - exercised in staging/prod
        logger.error("Alembic migrations to head failed", exc_info=exc)
        raise


async def _ensure_metrics_endpoint(app: FastAPI | None, strict: bool) -> None:
    if not strict:
        return
    if app is None:
        raise RuntimeError("Metrics endpoint verification requires a FastAPI app when strict startup checks are enabled")
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://startup-check") as client:
            response = await client.get("/metrics")
            if response.status_code in {301, 302, 307, 308}:
                # Some middleware (e.g., HTTPS redirect) may issue a redirect for /metrics.
                # Treat this as success since the endpoint exists and responders can follow.
                return
    except Exception as exc:
        logger.error("Metrics endpoint probe failed", exc_info=exc)
        raise RuntimeError("Metrics endpoint probe failed") from exc
    if response.status_code in {200, 204, 401}:
        return
    raise RuntimeError(f"Metrics endpoint returned unexpected status {response.status_code}")


async def run_preflight_checks(settings: Settings, app: FastAPI | None = None) -> None:
    """Run all startup preflight checks."""
    logger.info("Running startup preflight checks")
    await check_db_connectivity(settings.db_url)
    environment = str(settings.environment).lower()
    strict = environment in {"staging", "prod"} or bool(
        getattr(settings, "strict_startup_checks", False),
    )
    # Redis connectivity is only a hard requirement when Redis-backed rate
    # limiting is enabled. Otherwise, treat failures as a warning so staging
    # and dev can run without a Redis instance.
    if getattr(settings, "use_redis_rate_limiting", False):
        await check_redis_connectivity(settings.redis_url)
    else:
        try:
            await check_redis_connectivity(settings.redis_url)
        except Exception as exc:
            logger.warning(
                "Redis connectivity check failed with rate limiting disabled; continuing startup",
                exc_info=exc,
            )

    if strict:
        try:
            check_migrations_current(settings.db_url)
        except ValueError as exc:
            message = str(exc)
            # If there is no Alembic revision yet (fresh database), attempt to
            # run migrations automatically and then re-check. Other migration
            # errors remain fatal in strict environments.
            if "current=None" in message:
                _run_alembic_upgrade_head()
                check_migrations_current(settings.db_url)
            else:
                raise
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
        yield
    except Exception as exc:
        logger.critical("Preflight checks failed, exiting", exc_info=exc)
        sys.exit(1)
