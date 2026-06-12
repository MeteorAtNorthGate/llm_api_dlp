"""Statistics schemas — request/response models for token usage statistics."""

from uuid import UUID

from pydantic import BaseModel, Field


class ApiKeyStats(BaseModel):
    """Token consumption for a single virtual API key."""

    key_alias: str | None = None
    key_suffix: str
    input_tokens_cache_miss: int = 0
    input_tokens_cache_hit: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    token_percent: float = 0.0  # fraction of grand total (0-100)


class UserStats(BaseModel):
    """Aggregated token consumption for one user (chat + all API keys)."""

    user_id: UUID
    username: str
    email: str | None = None
    input_tokens_cache_miss: int = 0
    input_tokens_cache_hit: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    token_percent: float = 0.0  # fraction of grand total (0-100)
    api_keys: list[ApiKeyStats] = []


class StatisticsResponse(BaseModel):
    """Top-level response for the admin statistics table."""

    users: list[UserStats]
    total_users: int
    grand_total_tokens: int
    start_date: str
    end_date: str


class DailyUsage(BaseModel):
    """Token usage for a single day."""

    date: str  # "YYYY-MM-DD"
    input_tokens_cache_miss: int = 0
    input_tokens_cache_hit: int = 0
    output_tokens: int = 0


class UserUsageResponse(BaseModel):
    """Per-user usage page — daily breakdown for chart + summary."""

    user_id: UUID
    username: str
    email: str | None = None
    daily_usage: list[DailyUsage]
    summary: UserStats
    start_date: str
    end_date: str
