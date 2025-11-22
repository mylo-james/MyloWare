"""Drop job_code column

Revision ID: 20251119_01_drop_job_code_column
Revises: 20251115_01_add_webhook_dlq_table
Create Date: 2025-11-19 12:00:00.000000
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "20251119_01_drop_job_code_column"
down_revision = "20251115_01_add_webhook_dlq_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("runs", "job_code")


def downgrade() -> None:
    pass
