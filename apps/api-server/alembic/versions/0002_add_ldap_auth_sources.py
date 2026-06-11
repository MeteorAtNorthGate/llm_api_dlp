"""Add LDAP auth sources table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-11
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
    op.create_table(
        "ldap_auth_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("auth_type", sa.String(32), nullable=False, server_default="bind_dn"),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("security_protocol", sa.String(32), nullable=False, server_default="unencrypted"),
        sa.Column("host", sa.String(255), nullable=False, server_default=""),
        sa.Column("port", sa.Integer(), nullable=False, server_default="389"),
        sa.Column("bind_dn", sa.String(512), nullable=False, server_default=""),
        sa.Column("bind_password", sa.String(255), nullable=False, server_default=""),
        sa.Column("user_search_base", sa.String(512), nullable=False, server_default=""),
        sa.Column("user_filter", sa.String(512), nullable=False, server_default=""),
        sa.Column("admin_filter", sa.String(512), nullable=False, server_default=""),
        sa.Column("username_attr", sa.String(128), nullable=False, server_default=""),
        sa.Column("first_name_attr", sa.String(128), nullable=False, server_default=""),
        sa.Column("last_name_attr", sa.String(128), nullable=False, server_default=""),
        sa.Column("email_attr", sa.String(128), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("ldap_auth_sources")
