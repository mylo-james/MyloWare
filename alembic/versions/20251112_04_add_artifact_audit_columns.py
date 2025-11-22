"""Add prompt_signature, tool_invocations, retrieval_trace columns to artifacts"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20251112_04_add_artifact_audit_columns"
down_revision = "20251112_03_kb_pgvector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Widen alembic_version.version_num so longer revision identifiers fit.
    # The default Alembic table uses VARCHAR(32), but our revision IDs
    # (e.g. 20251112_04_add_artifact_audit_columns) are longer.
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")

    # Add prompt_signature column (SHA256 hex string)
    op.add_column("artifacts", sa.Column("prompt_signature", sa.Text(), nullable=True))
    
    # Add tool_invocations column (JSONB array of tool call records)
    op.add_column(
        "artifacts",
        sa.Column(
            "tool_invocations",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    
    # Add retrieval_trace column (JSONB for RAG audit trail)
    op.add_column(
        "artifacts",
        sa.Column(
            "retrieval_trace",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    
    # Add persona column for filtering artifacts by persona
    op.add_column("artifacts", sa.Column("persona", sa.Text(), nullable=True))
    
    # Create index on persona for faster filtering
    op.create_index("idx_artifacts_persona", "artifacts", ["persona"])


def downgrade() -> None:
    op.drop_index("idx_artifacts_persona", "artifacts")
    op.drop_column("artifacts", "persona")
    op.drop_column("artifacts", "retrieval_trace")
    op.drop_column("artifacts", "tool_invocations")
    op.drop_column("artifacts", "prompt_signature")
