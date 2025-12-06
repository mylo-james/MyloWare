"""Add telegram_chat_id to runs table."""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251205_150000"
down_revision = "20251205_140000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("telegram_chat_id", sa.String(length=64), nullable=True))
    op.create_index("ix_runs_telegram_chat_id", "runs", ["telegram_chat_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_telegram_chat_id", table_name="runs")
    op.drop_column("runs", "telegram_chat_id")
