"""AuditLog model — immutable audit trail for sensitive operations."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )  # Keycloak sub
    action: Mapped[str] = mapped_column(
        String(128), nullable=False
    )  # "key.generate", "key.revoke", "chat.completion", etc.
    resource_type: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )  # "api_key", "conversation", etc.
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    def __repr__(self) -> str:
        return f"<AuditLog {self.action} at {self.created_at}>"
