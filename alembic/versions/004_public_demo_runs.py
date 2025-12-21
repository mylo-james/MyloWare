"""Add public demo fields to runs.

Revision ID: 004_public_demo_runs
Revises: 003_jobs_queue
Create Date: 2025-12-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "004_public_demo_runs"
down_revision: Union[str, None] = "003_jobs_queue"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("public_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "runs",
        sa.Column("public_token", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "runs",
        sa.Column("public_expires_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ux_runs_public_token", "runs", ["public_token"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_runs_public_token", table_name="runs")
    op.drop_column("runs", "public_expires_at")
    op.drop_column("runs", "public_token")
    op.drop_column("runs", "public_demo")
