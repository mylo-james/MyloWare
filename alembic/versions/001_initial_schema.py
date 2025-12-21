"""Initial schema - all tables.

Revision ID: 001_initial
Revises:
Create Date: 2025-12-07

Creates:
- runs: Workflow execution tracking
- artifacts: Generated content storage
- chat_sessions: Telegram chat sessions
- audit_logs: System event logging
- feedback: Human feedback on outputs
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # runs - Workflow execution tracking
    # -------------------------------------------------------------------------
    op.create_table(
        "runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workflow_name", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("current_step", sa.String(64), nullable=True),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column(
            "artifacts", postgresql.JSON(), server_default=sa.text("'{}'::json"), nullable=True
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("llama_stack_trace_id", sa.String(64), nullable=True),
        sa.Column("user_id", sa.String(128), nullable=True),
        sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_runs_status", "runs", ["status"])
    op.create_index("ix_runs_created_at", "runs", ["created_at"])
    op.create_index("ix_runs_user_id", "runs", ["user_id"])

    # -------------------------------------------------------------------------
    # artifacts - Generated content storage
    # -------------------------------------------------------------------------
    op.create_table(
        "artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id"), nullable=False
        ),
        sa.Column("persona", sa.String(32), nullable=False),
        sa.Column("artifact_type", sa.String(64), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("uri", sa.String(512), nullable=True),
        sa.Column("metadata", postgresql.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_artifacts_run_id", "artifacts", ["run_id"])
    op.create_index("ix_artifacts_type", "artifacts", ["artifact_type"])

    # -------------------------------------------------------------------------
    # chat_sessions - Multi-worker session persistence
    # -------------------------------------------------------------------------
    op.create_table(
        "chat_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(128), nullable=False, unique=True),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_chat_sessions_user_id", "chat_sessions", ["user_id"])

    # -------------------------------------------------------------------------
    # audit_logs - System event logging
    # -------------------------------------------------------------------------
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(128), nullable=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id"), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(32), nullable=True),
        sa.Column("metadata", postgresql.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    # -------------------------------------------------------------------------
    # feedback - Human feedback on outputs
    # -------------------------------------------------------------------------
    op.create_table(
        "feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id"), nullable=False
        ),
        sa.Column(
            "artifact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("artifacts.id"),
            nullable=True,
        ),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_feedback_run_id", "feedback", ["run_id"])


def downgrade() -> None:
    op.drop_table("feedback")
    op.drop_table("audit_logs")
    op.drop_table("chat_sessions")
    op.drop_table("artifacts")
    op.drop_table("runs")
