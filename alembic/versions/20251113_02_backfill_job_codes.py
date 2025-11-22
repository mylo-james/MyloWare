"""Backfill job_code for existing runs

Revision ID: 20251113_02_backfill_job_codes
Revises: 20251113_01_add_job_code_to_runs
Create Date: 2025-11-13
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text
import random
import string


revision = "20251113_02_backfill_job_codes"
down_revision = "20251113_01_add_job_code_to_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:  # pragma: no cover - migration runtime
    conn = op.get_bind()
    # guard: column may not exist if migration order differs
    res = conn.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'runs' AND column_name = 'job_code'
            """
        )
    ).fetchone()
    if not res:
        return

    existing = set(
        r[0]
        for r in conn.execute(text("SELECT job_code FROM runs WHERE job_code IS NOT NULL"))
        if r[0]
    )
    null_rows = conn.execute(
        text("SELECT run_id, project FROM runs WHERE job_code IS NULL")
    ).fetchall()

    def gen(prefix: str | None = None) -> str:
        letters = "".join(random.choices(string.ascii_uppercase, k=3))
        digits = "".join(random.choices(string.digits, k=3))
        core = f"{letters}{digits}"
        if prefix:
            p = "".join([c for c in prefix.upper() if c.isalnum()])[:3]
            return f"{p}{core}"
        return core

    for run_id, project in null_rows:
        # simple retry loop to avoid collisions
        for _ in range(16):
            code = gen(project)
            if code not in existing:
                conn.execute(
                    text("UPDATE runs SET job_code = :code WHERE run_id = :rid"),
                    {"code": code, "rid": run_id},
                )
                existing.add(code)
                break


def downgrade() -> None:  # pragma: no cover - migration runtime
    # no-op data-only migration
    pass

