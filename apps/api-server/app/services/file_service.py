"""File service — MinIO object storage operations.

MinIO client is synchronous (blocking I/O), so all public functions
should be called via `asyncio.to_thread()` from async FastAPI endpoints.
"""

import io
import uuid

from minio import Minio
from minio.error import S3Error

from app.core.config import settings

_client: Minio | None = None


def _get_minio_client() -> Minio:
    """Get or create the MinIO client singleton. Ensures bucket exists."""
    global _client
    if _client is None:
        _client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
        # Ensure bucket exists on first use
        if not _client.bucket_exists(settings.MINIO_BUCKET):
            _client.make_bucket(settings.MINIO_BUCKET)
    return _client


def build_object_key(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    attachment_id: uuid.UUID,
    file_name: str,
) -> str:
    """Build MinIO object path: {user_id}/{conversation_id}/{attachment_id}/{file_name}."""
    return f"{user_id}/{conversation_id}/{attachment_id}/{file_name}"


def upload_file_sync(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    attachment_id: uuid.UUID,
    file_name: str,
    file_content: bytes,
    content_type: str,
) -> str:
    """Upload a file to MinIO (synchronous). Returns the object key.

    Call via asyncio.to_thread() from async endpoints.
    """
    client = _get_minio_client()
    object_key = build_object_key(user_id, conversation_id, attachment_id, file_name)
    file_size = len(file_content)
    client.put_object(
        settings.MINIO_BUCKET,
        object_key,
        io.BytesIO(file_content),
        file_size,
        content_type=content_type,
    )
    return object_key


def download_file_sync(bucket: str, object_key: str) -> bytes:
    """Download a file from MinIO (synchronous).

    Call via asyncio.to_thread() from async endpoints.
    """
    client = _get_minio_client()
    response = client.get_object(bucket, object_key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def delete_file_sync(bucket: str, object_key: str) -> None:
    """Delete a single file from MinIO (synchronous).

    Call via asyncio.to_thread() from async endpoints.
    """
    client = _get_minio_client()
    try:
        client.remove_object(bucket, object_key)
    except S3Error:
        pass  # Already deleted or doesn't exist — best effort


def delete_prefix_sync(bucket: str, prefix: str) -> None:
    """Delete all objects under a prefix (synchronous).

    Used to clean up all files for a deleted conversation.
    Call via asyncio.to_thread() from async endpoints.
    """
    client = _get_minio_client()
    objects = client.list_objects(bucket, prefix=prefix, recursive=True)
    for obj in objects:
        try:
            client.remove_object(bucket, obj.object_name)
        except S3Error:
            pass
