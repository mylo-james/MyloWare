"""add user_id to runs

Revision ID: 20251205_140000
Revises: 20251205_130000
Create Date: 2025-12-05 14:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251205_140000"
down_revision = "20251205_130000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("user_id", sa.String(length=128), nullable=True))
    op.create_index("ix_runs_user_id", "runs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_user_id", table_name="runs")
    op.drop_column("runs", "user_id")
