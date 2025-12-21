"""Add dead letter queue table.

Revision ID: 002_dead_letter
Revises: 001_initial
Create Date: 2025-01-XX

Creates:
- dead_letters: Stores failed webhook events for manual inspection and replay
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "002_dead_letter"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dead_letters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source", sa.String(50), nullable=False),  # "kieai", "remotion"
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payload", postgresql.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], name="fk_dead_letters_run_id"),
    )
    op.create_index("idx_dead_letters_run_id", "dead_letters", ["run_id"])
    op.create_index("idx_dead_letters_source", "dead_letters", ["source"])
    op.create_index("idx_dead_letters_resolved", "dead_letters", ["resolved_at"])


def downgrade() -> None:
    op.drop_index("idx_dead_letters_resolved", table_name="dead_letters")
    op.drop_index("idx_dead_letters_source", table_name="dead_letters")
    op.drop_index("idx_dead_letters_run_id", table_name="dead_letters")
    op.drop_table("dead_letters")
