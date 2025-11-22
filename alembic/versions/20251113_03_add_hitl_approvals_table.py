"""Add hitl_approvals table for audit logging

Revision ID: 20251113_03_add_hitl_approvals_table
Revises: 20251113_02_backfill_job_codes
Create Date: 2025-11-13
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20251113_03_add_hitl_approvals_table"
down_revision = "20251113_02_backfill_job_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:  # pragma: no cover
    op.create_table(
        "hitl_approvals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("gate", sa.Text(), nullable=False),
        sa.Column("approver_ip", sa.Text(), nullable=True),
        sa.Column("approver", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("idx_hitl_approvals_run_id", "hitl_approvals", ["run_id"])


def downgrade() -> None:  # pragma: no cover
    op.drop_index("idx_hitl_approvals_run_id", table_name="hitl_approvals")
    op.drop_table("hitl_approvals")
