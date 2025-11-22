"""Add webhook_dlq table for failed webhook processing

Revision ID: 20251115_01_add_webhook_dlq_table
Revises: 20251113_03_add_hitl_approvals_table
Create Date: 2025-11-15
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251115_01_add_webhook_dlq_table"
down_revision = "20251113_03_add_hitl_approvals_table"
branch_labels = None
depends_on = None


def upgrade() -> None:  # pragma: no cover - migration runtime
    op.create_table(
        "webhook_dlq",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("headers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("payload", sa.LargeBinary(), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("retry_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "last_error_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )
    op.create_unique_constraint(
        "uq_webhook_dlq_idempotency",
        "webhook_dlq",
        ["idempotency_key", "provider"],
    )
    op.create_index("idx_webhook_dlq_next_retry", "webhook_dlq", ["next_retry_at"])
    op.create_index("idx_webhook_dlq_provider", "webhook_dlq", ["provider"])


def downgrade() -> None:  # pragma: no cover - migration runtime
    op.drop_index("idx_webhook_dlq_provider", table_name="webhook_dlq")
    op.drop_index("idx_webhook_dlq_next_retry", table_name="webhook_dlq")
    op.drop_constraint("uq_webhook_dlq_idempotency", "webhook_dlq", type_="unique")
    op.drop_table("webhook_dlq")

