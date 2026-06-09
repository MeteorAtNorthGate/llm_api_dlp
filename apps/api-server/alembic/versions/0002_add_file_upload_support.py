"""Add file upload support — attachments table and content_parts column.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add content_parts JSONB column to messages
    op.add_column(
        "messages",
        sa.Column(
            "content_parts",
            postgresql.JSONB,
            nullable=True,
            server_default=None,
            comment="Multi-part content following OpenAI content part format",
        ),
    )

    # Create attachments table
    op.create_table(
        "attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("file_name", sa.String(512), nullable=False),
        sa.Column("file_size", sa.Integer, nullable=False),
        sa.Column("mime_type", sa.String(128), nullable=False),
        sa.Column("file_type", sa.String(32), nullable=False),
        sa.Column("storage_bucket", sa.String(128), nullable=False),
        sa.Column("storage_object_key", sa.String(1024), nullable=False),
        sa.Column("parsed_text", sa.Text, nullable=True),
        sa.Column("parsed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parse_error", sa.Text, nullable=True),
        sa.Column(
            "storage_status",
            sa.String(32),
            nullable=False,
            server_default="pending",
            comment="pending / completed / failed",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_attachments_conversation_id"), "attachments", ["conversation_id"]
    )
    op.create_index(
        op.f("ix_attachments_file_type"), "attachments", ["file_type"]
    )
    op.create_index(
        op.f("ix_attachments_message_id"), "attachments", ["message_id"]
    )
    op.create_index(
        op.f("ix_attachments_user_id"), "attachments", ["user_id"]
    )


def downgrade() -> None:
    op.drop_table("attachments")
    op.drop_column("messages", "content_parts")
