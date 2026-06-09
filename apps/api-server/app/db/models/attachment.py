"""Attachment model — file attachments linked to messages in a conversation."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Original file metadata
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_type: Mapped[str] = mapped_column(
        String(32), nullable=False, index=True
    )  # "pdf", "docx", "xlsx", "txt", "csv", "image"

    # MinIO storage
    storage_bucket: Mapped[str] = mapped_column(String(128), nullable=False)
    storage_object_key: Mapped[str] = mapped_column(String(1024), nullable=False)

    # Parsed content (populated by unstructured)
    parsed_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    parse_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="pending",
        comment="pending / completed / failed",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    conversation = relationship("Conversation", back_populates="attachments")
    message = relationship("Message", backref="attachments")

    def __repr__(self) -> str:
        return f"<Attachment {self.file_name} ({self.file_type}, {self.file_size}b)>"
