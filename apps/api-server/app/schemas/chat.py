"""Chat schemas — request/response models for conversation and streaming."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """A single message in the chat completion request."""
    role: str  # "user", "assistant", "system"
    content: str = ""
    content_parts: list[dict] | None = Field(
        default=None,
        description="Multi-part content (OpenAI format). "
        "Example: [{'type':'text','text':'...'},{'type':'file','file_reference':{'attachment_id':'...'}}]",
    )


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible chat completion request."""
    model: str = "deepseek-v4-flash"
    messages: list[ChatMessage]
    conversation_id: str | None = Field(
        default=None, description="Existing conversation ID for continuing a chat"
    )
    stream: bool = True
    temperature: float | None = 0.7
    max_tokens: int | None = None
    reasoning_effort: str | None = Field(
        default=None,
        description="Thinking depth: 'low', 'medium', 'high', 'max'. "
        "LiteLLM translates this to provider-specific formats "
        "(OpenAI reasoning.effort, DeepSeek thinking, GLM thinking+reasoning_effort).",
    )


class ConversationSummary(BaseModel):
    """Summary of a conversation for listing."""
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class AttachmentDetail(BaseModel):
    """Attachment metadata returned to the frontend."""
    id: UUID
    file_name: str
    file_size: int
    mime_type: str
    file_type: str
    storage_status: str
    parse_error: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageDetail(BaseModel):
    """A single message returned in conversation detail."""
    id: UUID
    role: str
    content: str
    content_parts: list[dict] | None = None
    attachments: list[AttachmentDetail] = []
    token_count: int | None = None
    model: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetail(BaseModel):
    """Full conversation with messages."""
    id: UUID
    title: str
    messages: list[MessageDetail]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
