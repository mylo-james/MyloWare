"""Vector DB helpers for Postgres + pgvector.

These helpers are thin convenience functions for ops/maintenance. Core query
paths (RAG, etc.) may still use raw SQL in `core/knowledge`.
"""
from __future__ import annotations

from .pgvector import (
    ensure_extension,
    create_hnsw_index,
    create_ivfflat_index,
    drop_vector_indexes,
    index_stats,
)

__all__ = [
    "ensure_extension",
    "create_hnsw_index",
    "create_ivfflat_index",
    "drop_vector_indexes",
    "index_stats",
]

