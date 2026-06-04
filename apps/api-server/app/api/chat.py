"""Chat API endpoints — streaming chat completion and conversation management."""

import json
import uuid
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.db.models.conversation import Conversation
from app.db.models.message import Message
from app.db.models.user import User
from app.db.session import get_session
from app.schemas.chat import (
    ChatCompletionRequest,
    ConversationDetail,
    ConversationSummary,
    MessageDetail,
)

router = APIRouter()


async def _get_or_create_user(
    session: AsyncSession, user_claims: dict
) -> User:
    """Get existing user or create a new one from Keycloak claims."""
    sub = user_claims.get("sub")
    result = await session.execute(
        select(User).where(User.keycloak_sub == sub)
    )
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            keycloak_sub=sub,
            username=user_claims.get("preferred_username", sub),
            email=user_claims.get("email"),
            department=user_claims.get("department"),
            groups=",".join(user_claims.get("groups", [])),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    return user


@router.post("/completions")
async def chat_completions(
    body: ChatCompletionRequest,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Streaming chat completion — proxies to LiteLLM with DLP masking.

    Saves messages to the database and returns SSE stream to the frontend.
    """
    user = await _get_or_create_user(session, user_claims)

    # Resolve conversation
    if body.conversation_id:
        result = await session.execute(
            select(Conversation).where(
                Conversation.id == uuid.UUID(body.conversation_id),
                Conversation.user_id == user.id,
            )
        )
        conversation = result.scalar_one_or_none()
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found",
            )
    else:
        # Create new conversation — title from first user message
        user_msgs = [m for m in body.messages if m.role == "user"]
        title = user_msgs[-1].content[:50] if user_msgs else "New Conversation"
        conversation = Conversation(user_id=user.id, title=title)
        session.add(conversation)
        await session.commit()
        await session.refresh(conversation)

    # Save user messages to DB
    for msg in body.messages:
        if msg.role == "user":
            db_msg = Message(
                conversation_id=conversation.id,
                role=msg.role,
                content=msg.content,
            )
            session.add(db_msg)
    await session.commit()

    # Build LiteLLM request payload
    litellm_payload = {
        "model": body.model,
        "messages": [m.model_dump() for m in body.messages],
        "stream": body.stream,
        "temperature": body.temperature,
    }
    if body.max_tokens:
        litellm_payload["max_tokens"] = body.max_tokens

    if body.stream:
        return StreamingResponse(
            _stream_response(litellm_payload, conversation.id, session),
            media_type="text/event-stream",
            headers={
                "X-Conversation-Id": str(conversation.id),
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
    else:
        # Non-streaming: return full response
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{settings.LITELLM_BASE_URL}/v1/chat/completions",
                json=litellm_payload,
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                    "Content-Type": "application/json",
                },
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"LiteLLM returned {resp.status_code}",
                )

            data = resp.json()

            # Save assistant response
            choice = data["choices"][0]
            assistant_msg = Message(
                conversation_id=conversation.id,
                role="assistant",
                content=choice["message"]["content"],
                token_count=data.get("usage", {}).get("total_tokens"),
                model=data.get("model"),
            )
            session.add(assistant_msg)
            await session.commit()

            return {
                "id": str(conversation.id),
                "model": data.get("model"),
                "choices": data.get("choices"),
                "usage": data.get("usage"),
            }


async def _stream_response(
    payload: dict,
    conversation_id: uuid.UUID,
    session: AsyncSession,
) -> AsyncGenerator[str, None]:
    """Stream SSE events from LiteLLM back to the frontend."""
    full_content = ""
    token_count = None
    model_name = None

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{settings.LITELLM_BASE_URL}/v1/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                    "Content-Type": "application/json",
                },
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    yield f"data: {{\"error\": \"LiteLLM returned {response.status_code}: {error_body.decode()}\"}}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data_str)
                            choices = chunk.get("choices", [])
                            if choices and choices[0].get("delta", {}).get("content"):
                                full_content += choices[0]["delta"]["content"]

                            # Capture usage/token info from final chunk
                            if chunk.get("usage"):
                                token_count = chunk["usage"].get("total_tokens")
                            if chunk.get("model"):
                                model_name = chunk["model"]

                        except json.JSONDecodeError:
                            pass

                        yield f"data: {data_str}\n\n"

                yield "data: [DONE]\n\n"

    except httpx.ReadTimeout:
        yield f"data: {{\"error\": \"Request to LLM timed out\"}}\n\n"
        yield "data: [DONE]\n\n"

    finally:
        # Save assistant message to DB
        if full_content:
            try:
                assistant_msg = Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=full_content,
                    token_count=token_count,
                    model=model_name,
                )
                session.add(assistant_msg)
                await session.commit()
            except Exception:
                pass


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations(
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """List all conversations for the current user."""
    user = await _get_or_create_user(session, user_claims)

    # Subquery to count messages per conversation
    msg_count_subq = (
        select(
            Message.conversation_id,
            func.count(Message.id).label("count"),
        )
        .group_by(Message.conversation_id)
        .subquery()
    )

    result = await session.execute(
        select(
            Conversation,
            func.coalesce(msg_count_subq.c.count, 0).label("message_count"),
        )
        .outerjoin(msg_count_subq, Conversation.id == msg_count_subq.c.conversation_id)
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
    )

    rows = result.all()
    summaries = []
    for conv, msg_count in rows:
        summaries.append(
            ConversationSummary(
                id=conv.id,
                title=conv.title,
                created_at=conv.created_at,
                updated_at=conv.updated_at,
                message_count=msg_count,
            )
        )

    return summaries


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Get a single conversation with all messages."""
    user = await _get_or_create_user(session, user_claims)

    result = await session.execute(
        select(Conversation).where(
            Conversation.id == uuid.UUID(conversation_id),
            Conversation.user_id == user.id,
        )
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    messages_result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.asc())
    )
    messages = messages_result.scalars().all()

    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        messages=[
            MessageDetail(
                id=m.id,
                role=m.role,
                content=m.content,
                token_count=m.token_count,
                model=m.model,
                created_at=m.created_at,
            )
            for m in messages
        ],
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Delete a conversation and its messages."""
    user = await _get_or_create_user(session, user_claims)

    result = await session.execute(
        select(Conversation).where(
            Conversation.id == uuid.UUID(conversation_id),
            Conversation.user_id == user.id,
        )
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    # Delete messages first
    await session.execute(
        select(Message).where(Message.conversation_id == conversation.id)
    )
    messages = (await session.execute(
        select(Message).where(Message.conversation_id == conversation.id)
    )).scalars().all()
    for msg in messages:
        await session.delete(msg)

    await session.delete(conversation)
    await session.commit()
