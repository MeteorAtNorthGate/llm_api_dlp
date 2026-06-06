"""Key schemas — request/response models for API key management."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class KeyGenerateRequest(BaseModel):
    """Request to generate a new virtual API key."""
    key_alias: str | None = Field(default=None, description="Human-readable name for the key")
    models: list[str] | None = Field(
        default=None, description="Allowed model whitelist (None = all)"
    )
    max_budget: float | None = Field(
        default=None, description="Maximum USD budget for this key"
    )
    rpm_limit: int | None = Field(
        default=None, description="Requests per minute limit"
    )
    tpm_limit: int | None = Field(
        default=None, description="Tokens per minute limit"
    )
    duration_days: int = Field(
        default=90, description="Key validity in days", ge=1, le=365
    )


class KeyGenerateResponse(BaseModel):
    """Response after generating a new virtual API key — key shown once."""
    id: UUID
    key_alias: str | None = None
    api_key: str  # Full key — shown only once
    key_suffix: str  # Last 4 chars for display
    models: list[str] = []
    max_budget: float | None = None
    expires_at: datetime | None = None
    created_at: datetime
    base_url: str = ""  # 用户使用该 Key 时应配置的 LiteLLM 公开地址


class KeySummary(BaseModel):
    """Summary of an API key for listing (no sensitive key material)."""
    id: UUID
    key_alias: str | None = None
    key_suffix: str
    models: list[str] = []
    max_budget: float | None = None
    rpm_limit: int | None = None
    tpm_limit: int | None = None
    is_active: bool
    expires_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class KeyUsageResponse(BaseModel):
    """Usage summary for the current user's keys."""
    total_keys: int
    active_keys: int
    total_spend_usd: float = 0.0
    keys: list[KeySummary] = []
