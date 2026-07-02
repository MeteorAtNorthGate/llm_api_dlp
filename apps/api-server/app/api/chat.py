"""Chat API endpoints — streaming chat completion and conversation management."""

import asyncio
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
from app.db.models.attachment import Attachment
from app.db.models.conversation import Conversation
from app.db.models.message import Message
from app.db.models.user import User
from app.db.session import get_session
from app.schemas.chat import (
    AttachmentDetail,
    ChatCompletionRequest,
    ConversationDetail,
    ConversationSummary,
    MessageDetail,
)
from app.services.dlp_service import apply_masking
from app.services.file_service import delete_prefix_sync
from app.services.parse_service import build_injection_text

router = APIRouter()


@router.get("/models")
async def list_available_models(
    user_claims: dict = Depends(get_current_user),
):
    """List models available for chat — any authenticated user can call."""
    import httpx

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{settings.LITELLM_BASE_URL}/model/info",
            headers={"Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}"},
        )
        if resp.status_code != 200:
            return {"models": []}

        data = resp.json()
        entries = data.get("data", [])

    models = []
    for entry in entries:
        model_name = entry.get("model_name", "unknown")
        model_info = entry.get("model_info", {}) or {}
        litellm_params = entry.get("litellm_params", {}) or {}

        # Skip models explicitly hidden from the chat picker.
        # system-utility is always excluded — it's the platform's own
        # internal model, never intended for direct user chat.
        if model_info.get("hidden_from_chat") or model_name == "system-utility":
            continue

        models.append({
            "id": model_info.get("id", model_name),
            "name": model_name,
            "provider": model_info.get("litellm_provider", ""),
            "description": model_info.get("description", ""),
        })

    return {"models": models}


def _apply_reasoning_params(
    payload: dict, model: str, reasoning_effort: str
) -> None:
    """Apply reasoning/thinking parameters to the LiteLLM payload.

    DeepSeek expects ``thinking: {type, reasoning_effort}`` while OpenAI
    uses ``reasoning.effort`` and GLM uses ``thinking+reasoning_effort``.
    This helper writes the provider-canonical format so LiteLLM can
    translate correctly, rather than relying on LiteLLM to guess from a
    top-level ``reasoning_effort`` key.
    """
    normalized = reasoning_effort.strip().lower()

    if not normalized:
        return  # let provider default

    # Detect DeepSeek models (name starts with "deepseek")
    if model.startswith("deepseek"):
        if normalized == "none":
            payload["thinking"] = {"type": "disabled"}
        else:
            payload["thinking"] = {
                "type": "enabled",
                "reasoning_effort": normalized,
            }
    else:
        # OpenAI / GLM / other providers — pass through
        # LiteLLM handles translation to provider-specific format for these
        payload["reasoning_effort"] = normalized


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

    # Determine if this is a new conversation needing AI title generation.
    # Capture BEFORE the truncation rename below — once renamed, the
    # title is no longer "New Conversation" and we lose the trigger.
    should_generate_title = conversation.title == "New Conversation"
    first_user_msg_content = None

    # Rename placeholder when the first real message arrives
    if conversation.title == "New Conversation":
        user_msgs = [m for m in body.messages if m.role == "user"]
        if user_msgs:
            first_user_msg_content = user_msgs[-1].content
            conversation.title = first_user_msg_content[:50]

    # Determine how many user messages already exist in this conversation.
    # (The frontend sends the full history each turn — we only persist NEW ones.)
    if body.conversation_id:
        count_result = await session.execute(
            select(func.count()).select_from(Message).where(
                Message.conversation_id == uuid.UUID(body.conversation_id),
                Message.role == "user",
            )
        )
        existing_user_count = count_result.scalar()
    else:
        existing_user_count = 0

    # Save only new user messages, building a position→db_msg map for attachment linking.
    position_to_db_msg: dict[int, Message] = {}
    user_idx = 0
    for i, msg in enumerate(body.messages):
        if msg.role == "user":
            if user_idx >= existing_user_count:
                db_msg = Message(
                    conversation_id=conversation.id,
                    role=msg.role,
                    content=msg.content,
                    content_parts=msg.content_parts,
                )
                session.add(db_msg)
                position_to_db_msg[i] = db_msg
            user_idx += 1

    if position_to_db_msg:
        await session.flush()  # generate IDs so we can link attachments below
    await session.commit()

    # Build LiteLLM-compatible messages with file content injected and DLP applied
    litellm_messages = []
    for i, msg in enumerate(body.messages):
        if msg.content_parts and msg.role == "user":
            # Process multi-part content — inject parsed file text
            text_parts = []
            for part in msg.content_parts:
                if part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
                elif part.get("type") == "file":
                    ref = part.get("file_reference", {})
                    att_id = ref.get("attachment_id")
                    if att_id:
                        att_result = await session.execute(
                            select(Attachment).where(
                                Attachment.id == uuid.UUID(att_id)
                            )
                        )
                        attachment = att_result.scalar_one_or_none()
                        if attachment and attachment.parsed_text and attachment.storage_status == "completed":
                            injection = build_injection_text(
                                attachment.parsed_text, attachment.file_name
                            )
                            text_parts.append(injection)
                            # Link attachment to the correct message (the one just saved for this position)
                            linked_msg = position_to_db_msg.get(i)
                            if linked_msg:
                                attachment.message_id = linked_msg.id

            combined_text = "\n".join(text_parts) if text_parts else msg.content

            # Apply DLP masking
            mask_result = apply_masking(combined_text)
            litellm_messages.append({
                "role": msg.role,
                "content": mask_result.masked_text,
            })
        elif msg.role in ("user", "system"):
            # Standard text message with DLP
            mask_result = apply_masking(msg.content)
            litellm_messages.append({
                "role": msg.role,
                "content": mask_result.masked_text,
            })
        else:
            # Assistant messages — no DLP needed (they're history context)
            litellm_messages.append({
                "role": msg.role,
                "content": msg.content,
            })

    await session.commit()
    # Build LiteLLM request payload using DLP-masked + file-injected messages
    litellm_payload = {
        "model": body.model,
        "messages": litellm_messages,
        "stream": body.stream,
        "temperature": body.temperature,
        "user": user.keycloak_sub,
    }
    if body.max_tokens:
        litellm_payload["max_tokens"] = body.max_tokens
    if body.reasoning_effort:
        _apply_reasoning_params(litellm_payload, body.model, body.reasoning_effort)

    if body.stream:
        return StreamingResponse(
            _stream_response(
                litellm_payload,
                conversation.id,
                session,
                first_user_message=first_user_msg_content,
                should_generate_title=should_generate_title,
            ),
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
                content=choice["message"]["content"] or "",
                reasoning_content=choice["message"].get("reasoning_content"),
                token_count=data.get("usage", {}).get("total_tokens"),
                model=data.get("model"),
            )
            session.add(assistant_msg)
            await session.commit()

            # Fire background title generation (same trigger as streaming path)
            if should_generate_title and first_user_msg_content:
                import logging

                _logger = logging.getLogger(__name__)
                _logger.info(
                    "Firing background title generation for conversation %s (non-streaming)",
                    conversation.id,
                )
                from app.services.title_service import (
                    regenerate_conversation_title,
                )

                asyncio.create_task(
                    regenerate_conversation_title(
                        conversation_id=conversation.id,
                        user_message=first_user_msg_content,
                        assistant_response=assistant_msg.content,
                    )
                )

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
    first_user_message: str | None = None,
    should_generate_title: bool = False,
) -> AsyncGenerator[str, None]:
    """Stream SSE events from LiteLLM back to the frontend."""
    full_content = ""
    full_reasoning = ""
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
                            if choices:
                                delta = choices[0].get("delta", {})
                                if delta.get("content"):
                                    full_content += delta["content"]
                                if delta.get("reasoning_content"):
                                    full_reasoning += delta["reasoning_content"]

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
        if full_content or full_reasoning:
            try:
                assistant_msg = Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=full_content,
                    reasoning_content=full_reasoning or None,
                    token_count=token_count,
                    model=model_name,
                )
                session.add(assistant_msg)
                await session.commit()

                # Fire background title generation for new conversations.
                if should_generate_title and first_user_message:
                    import logging

                    _logger = logging.getLogger(__name__)
                    _logger.info(
                        "Firing background title generation for conversation %s",
                        conversation_id,
                    )
                    from app.services.title_service import (
                        regenerate_conversation_title,
                    )

                    asyncio.create_task(
                        regenerate_conversation_title(
                            conversation_id=conversation_id,
                            user_message=first_user_message,
                            assistant_response=full_content,
                        )
                    )
            except Exception:
                pass


@router.post("/conversations", response_model=ConversationSummary, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Create an empty placeholder conversation for the chat UI.

    Called when the user enters the chat page or clicks "New Chat".
    Reuses an existing empty "New Conversation" if one already exists,
    so page refreshes / redirects don't pile up placeholder rows.
    """
    user = await _get_or_create_user(session, user_claims)

    # Reuse an existing empty placeholder instead of creating duplicates
    existing = await session.execute(
        select(Conversation)
        .outerjoin(Message, Conversation.id == Message.conversation_id)
        .where(
            Conversation.user_id == user.id,
            Conversation.title == "New Conversation",
        )
        .group_by(Conversation.id)
        .having(func.count(Message.id) == 0)
        .order_by(Conversation.created_at.desc())
        .limit(1)
    )
    placeholder = existing.scalar_one_or_none()
    if placeholder:
        return ConversationSummary(
            id=placeholder.id,
            title=placeholder.title,
            created_at=placeholder.created_at,
            updated_at=placeholder.updated_at,
            message_count=0,
        )

    conversation = Conversation(user_id=user.id, title="New Conversation")
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)

    return ConversationSummary(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        message_count=0,
    )


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

    # Load attachments for all messages in this conversation
    attachment_result = await session.execute(
        select(Attachment).where(
            Attachment.conversation_id == conversation.id
        )
    )
    attachments_by_message: dict[uuid.UUID, list[Attachment]] = {}
    for att in attachment_result.scalars().all():
        if att.message_id:
            attachments_by_message.setdefault(att.message_id, []).append(att)

    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        messages=[
            MessageDetail(
                id=m.id,
                role=m.role,
                content=m.content,
                content_parts=m.content_parts,
                reasoning_content=m.reasoning_content,
                attachments=[
                    AttachmentDetail.model_validate(att)
                    for att in attachments_by_message.get(m.id, [])
                ],
                token_count=m.token_count,
                model=m.model,
                created_at=m.created_at,
            )
            for m in messages
        ],
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


@router.post("/conversations/{conversation_id}/prune-last-turn")
async def prune_last_turn(
    conversation_id: str,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Delete the last user message and all subsequent messages.

    Used by the frontend when a user edits and resends their last message,
    so the DB state stays in sync with the truncated client-side history.
    """
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

    # Find the last user message in this conversation.
    last_user_result = await session.execute(
        select(Message)
        .where(
            Message.conversation_id == conversation.id,
            Message.role == "user",
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    last_user_msg = last_user_result.scalar_one_or_none()

    if last_user_msg is None:
        return {"pruned": 0}

    # Delete that message and everything created after it (assistant replies).
    prune_result = await session.execute(
        select(Message).where(
            Message.conversation_id == conversation.id,
            Message.created_at >= last_user_msg.created_at,
        )
    )
    pruned_count = 0
    for msg in prune_result.scalars().all():
        await session.delete(msg)
        pruned_count += 1

    await session.commit()
    return {"pruned": pruned_count}


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

    # Bulk-delete all MinIO files under this conversation's prefix
    import asyncio

    prefix = f"{user.id}/{conversation.id}/"
    await asyncio.to_thread(
        delete_prefix_sync, settings.MINIO_BUCKET, prefix
    )

    # Delete messages first (attachments cascade via FK ondelete SET NULL)
    messages_result = await session.execute(
        select(Message).where(Message.conversation_id == conversation.id)
    )
    for msg in messages_result.scalars().all():
        await session.delete(msg)

    await session.delete(conversation)
    await session.commit()
