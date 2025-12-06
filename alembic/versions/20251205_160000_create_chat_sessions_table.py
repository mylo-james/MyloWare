"""Create chat_sessions table.

Revision ID: 20251205_160000
Revises: 20251205_150000
Create Date: 2025-12-05 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20251205_160000"
down_revision: Union[str, None] = "20251205_150000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create chat_sessions table for multi-worker session persistence."""
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(128), nullable=False, unique=True, index=True),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    """Drop chat_sessions table."""
    op.drop_table("chat_sessions")

