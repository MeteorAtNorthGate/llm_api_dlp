"""Add search_meta column to messages table.

Stores the DeepSeek web-search trace for an assistant turn: the queries the
model issued and the pages it opened.  NULL for non-search turns and for every
message that predates the Responses transport.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-21
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS keeps this idempotent, matching 0002.  Not strictly needed
    # now that docker-entrypoint.sh resolves the starting revision properly,
    # but it costs nothing and survives a half-applied run.
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_meta JSONB")


def downgrade() -> None:
    op.drop_column("messages", "search_meta")
