from __future__ import annotations

"""Minimal pgvector helpers for index ops and basic stats.

These functions are safe no-ops when psycopg is unavailable. They are intended
for maintenance flows (CLI/admin tasks) and not required on the hot path.
"""

from typing import Any, Mapping

try:  # optional dependency on the server
    import psycopg
    from psycopg.rows import dict_row
    _PSYCOPG = True
except Exception:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]
    _PSYCOPG = False


def _connect(dsn: str):  # type: ignore[override]
    if not _PSYCOPG:  # pragma: no cover
        raise RuntimeError("psycopg is not installed")
    # Autocommit for DDL
    return psycopg.connect(dsn, autocommit=True, row_factory=dict_row)


def ensure_extension(dsn: str) -> None:
    """Create the vector extension if it does not exist."""
    if not _PSYCOPG:  # pragma: no cover
        return
    with _connect(_normalize_dsn(dsn)) as conn:  # type: ignore[arg-type]
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")


def create_hnsw_index(
    dsn: str,
    *,
    table: str,
    column: str = "embedding",
    index_name: str | None = None,
    m: int = 16,
    ef_construction: int = 200,
    opclass: str = "vector_l2_ops",
) -> None:
    """Create an HNSW index for the given table/column."""
    if not _PSYCOPG:  # pragma: no cover
        return
    index = index_name or f"{table}_{column}_hnsw_idx"
    sql = (
        f"CREATE INDEX IF NOT EXISTS {index} ON {table} USING hnsw ({column} {opclass}) "
        f"WITH (m = {m}, ef_construction = {ef_construction});"
    )
    with _connect(_normalize_dsn(dsn)) as conn:  # type: ignore[arg-type]
        conn.execute(sql)


def create_ivfflat_index(
    dsn: str,
    *,
    table: str,
    column: str = "embedding",
    index_name: str | None = None,
    lists: int = 100,
    opclass: str = "vector_l2_ops",
) -> None:
    """Create an IVFFlat index for the given table/column."""
    if not _PSYCOPG:  # pragma: no cover
        return
    index = index_name or f"{table}_{column}_ivfflat_idx"
    sql = (
        f"CREATE INDEX IF NOT EXISTS {index} ON {table} USING ivfflat ({column} {opclass}) "
        f"WITH (lists = {lists});"
    )
    with _connect(_normalize_dsn(dsn)) as conn:  # type: ignore[arg-type]
        conn.execute(sql)


def drop_vector_indexes(dsn: str, *, table: str, prefix: str | None = None) -> int:
    """Drop indexes on table that match an optional prefix. Returns count."""
    if not _PSYCOPG:  # pragma: no cover
        return 0
    with _connect(_normalize_dsn(dsn)) as conn:  # type: ignore[arg-type]
        rows = conn.execute(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = ANY (current_schemas(false))
              AND tablename = %s
              AND indexdef ILIKE '% USING hnsw %' OR indexdef ILIKE '% USING ivfflat %'
            """,
            (table,),
        ).fetchall()
        to_drop: list[str] = []
        for r in rows:
            name = r.get("indexname") if isinstance(r, Mapping) else r[0]
            if prefix and not str(name).startswith(prefix):
                continue
            to_drop.append(str(name))
        for name in to_drop:
            conn.execute(f"DROP INDEX IF EXISTS {name};")
        return len(to_drop)


def index_stats(dsn: str, *, table: str) -> list[dict[str, Any]]:
    """Return basic index metadata for the table (name, method, size)."""
    if not _PSYCOPG:  # pragma: no cover
        return []
    with _connect(_normalize_dsn(dsn)) as conn:  # type: ignore[arg-type]
        rows = conn.execute(
            """
            SELECT
                idx.indexrelid::regclass AS name,
                am.amname                AS method,
                pg_relation_size(idx.indexrelid) AS bytes
            FROM pg_index idx
            JOIN pg_class cls ON cls.oid = idx.indrelid
            JOIN pg_am am   ON am.oid = (SELECT am.oid FROM pg_class c JOIN pg_am am ON am.oid = c.relam WHERE c.oid = idx.indexrelid)
            WHERE cls.relname = %s;
            """,
            (table,),
        ).fetchall()
        results: list[dict[str, Any]] = []
        for r in rows:
            if isinstance(r, Mapping):
                results.append({"name": r["name"], "method": r["method"], "bytes": int(r["bytes"])})
            else:
                results.append({"name": r[0], "method": r[1], "bytes": int(r[2])})
        return results


def _normalize_dsn(dsn: str) -> str:
    # Allow callers to pass SQLAlchemy-style URLs
    return dsn.replace("postgresql+psycopg://", "postgresql://", 1)

