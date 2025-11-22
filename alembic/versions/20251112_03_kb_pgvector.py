"""Add KB tables with pgvector embeddings"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20251112_03_kb_pgvector"
down_revision = "20251112_02_add_socials_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Detect pgvector extension where available.
    # Some staging / dev databases may not have the pgvector extension
    # installed at the server level. In those environments, we still want
    # the KB tables created, but we fall back to a non-vector embedding
    # column and skip ivfflat indexes. When pgvector is available, we
    # promote the embedding column to the real vector type.
    bind = op.get_bind()
    supports_pgvector = False
    try:
        result = bind.execute(sa.text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
        supports_pgvector = result.scalar() is not None
    except Exception:
        # If the pg_extension catalog isn't available or any other error occurs,
        # assume pgvector is not installed and continue with the fallback path.
        supports_pgvector = False

    # Documents
    op.create_table(
        "kb_documents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("project", sa.Text(), nullable=True),
        sa.Column("persona", sa.Text(), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("idx_kb_documents_project_persona", "kb_documents", ["project", "persona"])

    # Embeddings
    op.create_table(
        "kb_embeddings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("doc_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("kb_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("embedding", sa.dialects.postgresql.DOUBLE_PRECISION().with_variant(sa.dialects.postgresql.FLOAT(53), "postgresql"), nullable=True),
    )
    # Index on doc_id is useful regardless of pgvector availability.
    op.create_index("idx_kb_embeddings_doc", "kb_embeddings", ["doc_id"])

    # Maintain the embedding_vec helper column for compatibility with earlier
    # migration iterations, even when pgvector is not available.
    op.add_column("kb_embeddings", sa.Column("embedding_vec", sa.TEXT(), nullable=True))

    if supports_pgvector:
        # Promote the embedding column to the pgvector type and add an IVFFLAT
        # index for efficient similarity search.
        op.execute("ALTER TABLE kb_embeddings DROP COLUMN embedding")
        op.execute("ALTER TABLE kb_embeddings ADD COLUMN embedding vector(1536)")
        op.execute(
            "CREATE INDEX idx_kb_embeddings_cosine "
            "ON kb_embeddings USING ivfflat (embedding vector_cosine_ops)",
        )


def downgrade() -> None:
    op.drop_index("idx_kb_embeddings_cosine")
    op.drop_index("idx_kb_embeddings_doc")
    op.drop_table("kb_embeddings")
    op.drop_index("idx_kb_documents_project_persona")
    op.drop_table("kb_documents")
    # Do not drop extension
