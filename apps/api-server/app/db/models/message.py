"""Message model — individual user/assistant messages in a conversation."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # "user", "assistant", "system"
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Structured multi-part content (OpenAI content part format)
    # Example: [{"type":"text","text":"..."},{"type":"file","file_reference":{"attachment_id":"..."}}]
    # NULL for legacy messages — fall back to `content` field
    content_parts: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True, default=None
    )

    # Token usage tracking (for DLP verification — masked vs unmasked should match)
    token_count: Mapped[int | None] = mapped_column(nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")

    def __repr__(self) -> str:
        return f"<Message {self.role} [{self.token_count} tokens]>"
