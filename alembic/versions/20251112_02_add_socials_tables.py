"""Add socials and project_socials tables"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20251112_02_add_socials_tables"
down_revision = "20251111_01_bootstrap_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "socials",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("account_id", sa.Text(), nullable=False),
        sa.Column("credential_ref", sa.Text(), nullable=True),
        sa.Column("default_caption", sa.Text(), nullable=True),
        sa.Column("default_tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("privacy", sa.Text(), nullable=True),
        sa.Column("rate_limit_window", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )

    op.create_table(
        "project_socials",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("project", sa.Text(), nullable=False),
        sa.Column("social_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("socials.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("project_socials")
    op.drop_table("socials")


