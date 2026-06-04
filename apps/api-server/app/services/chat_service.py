"""Chat service — business logic for chat operations."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.conversation import Conversation
from app.db.models.message import Message


async def update_conversation_title(
    session: AsyncSession, conversation: Conversation, title: str
) -> None:
    """Update the conversation title."""
    conversation.title = title
    await session.commit()


async def get_message_count(
    session: AsyncSession, conversation_id: str
) -> int:
    """Get the number of messages in a conversation."""
    from sqlalchemy import func, select

    result = await session.execute(
        select(func.count(Message.id)).where(
            Message.conversation_id == conversation_id
        )
    )
    return result.scalar() or 0
