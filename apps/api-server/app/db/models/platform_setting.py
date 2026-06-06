"""Platform settings — simple key-value store for admin-configurable options."""

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(
        String(128), primary_key=True
    )
    value: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=""
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<PlatformSetting {self.key}={self.value}>"
