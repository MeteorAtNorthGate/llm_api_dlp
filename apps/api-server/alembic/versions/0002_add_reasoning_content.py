"""Add reasoning_content column to messages table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "reasoning_content",
            sa.Text,
            nullable=True,
            server_default=None,
        ),
    )


def downgrade() -> None:
    op.drop_column("messages", "reasoning_content")
