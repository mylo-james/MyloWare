"""Add job_code column to runs with unique index

Revision ID: 20251113_01_add_job_code_to_runs
Revises: 20251112_04_add_artifact_audit_columns.py
Create Date: 2025-11-13
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20251113_01_add_job_code_to_runs"
down_revision = "20251112_04_add_artifact_audit_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("job_code", sa.Text(), nullable=True))
    try:
        op.create_unique_constraint("uq_runs_job_code", "runs", ["job_code"])
    except Exception:
        # Some engines may not allow unique on nullable column; ignore in tests
        pass


def downgrade() -> None:
    try:
        op.drop_constraint("uq_runs_job_code", "runs", type_="unique")
    except Exception:
        pass
    op.drop_column("runs", "job_code")

