"""ApiKey model — tracks virtual API keys issued to developers."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # LiteLLM external key info
    litellm_key_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    key_alias: Mapped[str] = mapped_column(String(255), nullable=True)
    key_suffix: Mapped[str] = mapped_column(
        String(10), nullable=False
    )  # last 4 chars for display

    # Limits
    model_whitelist: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # JSON array string
    max_budget: Mapped[float | None] = mapped_column(nullable=True)
    rpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(default=True)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user = relationship("User", back_populates="api_keys")

    def __repr__(self) -> str:
        return f"<ApiKey sk-...{self.key_suffix}>"
