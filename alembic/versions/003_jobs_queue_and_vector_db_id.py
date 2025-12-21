"""Add jobs queue and persist vector_db_id on runs.

Revision ID: 003_jobs_queue
Revises: 002_dead_letter
Create Date: 2025-12-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "003_jobs_queue"
down_revision: Union[str, None] = "002_dead_letter"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Persist vector DB identifier on each run so workers can execute without FastAPI app state.
    op.add_column("runs", sa.Column("vector_db_id", sa.String(length=128), nullable=True))

    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_type", sa.String(length=80), nullable=False),
        sa.Column("idempotency_key", sa.String(length=160), nullable=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "payload", postgresql.JSON(), nullable=False, server_default=sa.text("'{}'::json")
        ),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("available_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("claimed_by", sa.String(length=128), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], name="fk_jobs_run_id"),
    )
    op.create_index("ix_jobs_status_available_at", "jobs", ["status", "available_at"])
    op.create_index("ix_jobs_run_id", "jobs", ["run_id"])
    op.create_index("ix_jobs_lease_expires_at", "jobs", ["lease_expires_at"])
    op.create_index(
        "ux_jobs_type_idempotency",
        "jobs",
        ["job_type", "idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_jobs_type_idempotency", table_name="jobs")
    op.drop_index("ix_jobs_lease_expires_at", table_name="jobs")
    op.drop_index("ix_jobs_run_id", table_name="jobs")
    op.drop_index("ix_jobs_status_available_at", table_name="jobs")
    op.drop_table("jobs")
    op.drop_column("runs", "vector_db_id")
