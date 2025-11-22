from __future__ import annotations

from functools import lru_cache
import logging
from psycopg_pool import ConnectionPool
from langgraph.checkpoint.postgres import PostgresSaver

from .config import get_settings

logger = logging.getLogger("myloware.orchestrator.checkpointer")

def _normalize_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+"):
        return dsn.replace("postgresql+psycopg", "postgresql", 1)
    return dsn


def _build_postgres_saver() -> PostgresSaver:
    """Build a PostgresSaver with a connection pool for reliability.
    
    Uses psycopg_pool to handle connection lifecycle, reconnection,
    and prevents 'connection is closed' errors in long-running processes.
    """
    settings = get_settings()
    
    # Create a connection pool instead of a single connection
    # min_size=1, max_size=10 is reasonable for orchestrator workload
    pool = ConnectionPool(
        _normalize_dsn(settings.db_url),
        min_size=1,
        max_size=10,
        open=True,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,  # Disable prepared statements for pool
        },
    )
    
    saver = PostgresSaver(pool)
    saver.setup()
    return saver


@lru_cache(maxsize=1)
def get_graph_checkpointer() -> PostgresSaver:
    """Return a shared persistent LangGraph checkpointer with connection pooling."""
    return _build_postgres_saver()


def close_graph_checkpointer() -> None:
    """Close the shared PostgresSaver connection pool safely."""
    try:
        saver = get_graph_checkpointer()
    except Exception:  # pragma: no cover - defensive
        return
    pool = getattr(saver, "pool", None)
    if pool:
        try:
            pool.close()
            logger.info("Closed LangGraph PostgresSaver connection pool")
        except Exception:  # pragma: no cover - defensive
            logger.warning("Failed to close LangGraph PostgresSaver pool", exc_info=True)


__all__ = ["get_graph_checkpointer", "close_graph_checkpointer"]
