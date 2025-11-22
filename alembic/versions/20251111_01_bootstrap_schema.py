"""Bootstrap orchestration schema"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20251111_01_bootstrap_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("run_id", sa.Text(), primary_key=True),
        sa.Column("project", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )

    op.create_table(
        "artifacts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("run_id", sa.Text(), sa.ForeignKey("runs.run_id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("checksum", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )

    op.create_table(
        "webhook_events",
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
        sa.Column("signature_status", sa.Text(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_unique_constraint("uq_webhook_events_idempotency", "webhook_events", ["idempotency_key"])

    op.create_table(
        "orchestration_checkpoints",
        sa.Column("run_id", sa.Text(), primary_key=True),
        sa.Column("state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("orchestration_checkpoints")
    op.drop_constraint("uq_webhook_events_idempotency", "webhook_events", type_="unique")
    op.drop_table("webhook_events")
    op.drop_table("artifacts")
    op.drop_table("runs")
