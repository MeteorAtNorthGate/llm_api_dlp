"""LDAP auth source — per-source configuration for domain controller authentication."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LdapAuthSource(Base):
    __tablename__ = "ldap_auth_sources"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Auth type: "bind_dn" (default), "principal", "anonymous"
    auth_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="bind_dn"
    )
    # Display name shown on login page (replaces hardcoded "域控登录 (Windows AD)")
    name: Mapped[str] = mapped_column(
        String(255), nullable=False, default=""
    )
    # Security protocol: "unencrypted", "ldaps", "starttls"
    security_protocol: Mapped[str] = mapped_column(
        String(32), nullable=False, default="unencrypted"
    )
    # Host address, e.g. mydomain.com
    host: Mapped[str] = mapped_column(
        String(255), nullable=False, default=""
    )
    # Host port, e.g. 389, 636
    port: Mapped[int] = mapped_column(
        Integer, nullable=False, default=389
    )
    # Bind DN, e.g. cn=Search,dc=mydomain,dc=com
    bind_dn: Mapped[str] = mapped_column(
        String(512), nullable=False, default=""
    )
    # Bind password — stored in plaintext. Warning shown in UI.
    bind_password: Mapped[str] = mapped_column(
        String(255), nullable=False, default=""
    )
    # User search base, e.g. ou=Users,dc=mydomain,dc=com
    user_search_base: Mapped[str] = mapped_column(
        String(512), nullable=False, default=""
    )
    # User filter rule, e.g. (&(objectClass=posixAccount)(uid=%s))
    user_filter: Mapped[str] = mapped_column(
        String(512), nullable=False, default=""
    )
    # Admin filter rule
    admin_filter: Mapped[str] = mapped_column(
        String(512), nullable=False, default=""
    )
    # Username attribute — leave empty to use the login username as-is
    username_attr: Mapped[str] = mapped_column(
        String(128), nullable=False, default=""
    )
    # First name attribute
    first_name_attr: Mapped[str] = mapped_column(
        String(128), nullable=False, default=""
    )
    # Last name attribute
    last_name_attr: Mapped[str] = mapped_column(
        String(128), nullable=False, default=""
    )
    # Email attribute, e.g. "mail"
    email_attr: Mapped[str] = mapped_column(
        String(128), nullable=False, default=""
    )
    # Whether this source is enabled
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<LdapAuthSource {self.name} ({self.host}:{self.port})>"
