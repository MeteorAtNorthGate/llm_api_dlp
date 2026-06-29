"""File upload and management API endpoints."""

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.db.models.attachment import Attachment
from app.db.models.conversation import Conversation
from app.db.models.user import User
from app.db.session import get_session
from app.schemas.chat import AttachmentDetail
from app.services.file_service import delete_file_sync, upload_file_sync
from app.services.parse_service import SUPPORTED_EXTENSIONS, parse_document

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


@router.post(
    "/upload",
    response_model=AttachmentDetail,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    file: UploadFile = File(...),
    conversation_id: str = Form(...),
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Upload a file, store in MinIO, parse it, and return attachment metadata.

    The frontend calls this before sending a chat message. The returned
    attachment_id is embedded in the message's content_parts.
    """
    import asyncio

    user = await _get_or_create_user(session, user_claims)

    # Validate conversation access
    conv_uuid = uuid.UUID(conversation_id)
    result = await session.execute(
        select(Conversation).where(
            Conversation.id == conv_uuid,
            Conversation.user_id == user.id,
        )
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    # Validate file
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required",
        )

    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {ext}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds max size of {settings.MAX_FILE_SIZE_MB}MB",
        )

    # Determine file_type (strip leading dot from extension)
    mime_type = file.content_type or "application/octet-stream"
    file_type = ext.lstrip(".")

    # Create attachment record
    attachment_id = uuid.uuid4()
    attachment = Attachment(
        id=attachment_id,
        conversation_id=conv_uuid,
        user_id=user.id,
        file_name=file.filename,
        file_size=len(content),
        mime_type=mime_type,
        file_type=file_type,
        storage_bucket=settings.MINIO_BUCKET,
        storage_object_key="",  # Set after upload
        storage_status="pending",
    )
    session.add(attachment)
    await session.commit()

    try:
        # Upload to MinIO (sync client → run in thread)
        object_key = await asyncio.to_thread(
            upload_file_sync,
            user.id,
            conv_uuid,
            attachment_id,
            file.filename,
            content,
            mime_type,
        )
        attachment.storage_object_key = object_key

        # Parse document
        try:
            parsed_text = await asyncio.to_thread(
                parse_document, content, file.filename
            )
            attachment.parsed_text = parsed_text
            attachment.parsed_at = datetime.now(timezone.utc)
            attachment.storage_status = "completed"
        except Exception as e:
            attachment.storage_status = "failed"
            attachment.parse_error = str(e)

        await session.commit()
        await session.refresh(attachment)

    except Exception as e:
        attachment.storage_status = "failed"
        attachment.parse_error = str(e)
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"File processing failed: {e}",
        )

    return _attachment_to_schema(attachment)


@router.get("/{attachment_id}", response_model=AttachmentDetail)
async def get_attachment(
    attachment_id: str,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Get attachment metadata. Frontend uses this to check parse status."""
    user = await _get_or_create_user(session, user_claims)
    att_uuid = uuid.UUID(attachment_id)

    result = await session.execute(
        select(Attachment).where(
            Attachment.id == att_uuid,
            Attachment.user_id == user.id,
        )
    )
    attachment = result.scalar_one_or_none()
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment not found",
        )

    return _attachment_to_schema(attachment)


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    attachment_id: str,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Delete an attachment (MinIO file + DB record)."""
    import asyncio

    user = await _get_or_create_user(session, user_claims)
    att_uuid = uuid.UUID(attachment_id)

    result = await session.execute(
        select(Attachment).where(
            Attachment.id == att_uuid,
            Attachment.user_id == user.id,
        )
    )
    attachment = result.scalar_one_or_none()
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment not found",
        )

    # Delete from MinIO
    if attachment.storage_object_key:
        await asyncio.to_thread(
            delete_file_sync,
            attachment.storage_bucket,
            attachment.storage_object_key,
        )

    await session.delete(attachment)
    await session.commit()


def _attachment_to_schema(att: Attachment) -> AttachmentDetail:
    """Convert Attachment ORM model to Pydantic schema."""
    return AttachmentDetail(
        id=att.id,
        file_name=att.file_name,
        file_size=att.file_size,
        mime_type=att.mime_type,
        file_type=att.file_type,
        storage_status=att.storage_status,
        parse_error=att.parse_error,
        created_at=att.created_at,
    )
