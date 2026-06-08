"""System admin endpoints — manage LLM provider models and API keys.

Only users in the 'admins' Keycloak group can access these endpoints.
All operations proxy to LiteLLM's Admin API using the master key.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.db.models.platform_setting import PlatformSetting
from app.db.session import get_session

router = APIRouter()

# ── Provider → litellm model prefix mapping ──────────────────────────

PROVIDER_PREFIX: dict[str, str] = {
    "openai": "openai",
    "azure": "azure",
    "anthropic": "anthropic",
    "qwen": "openai",            # Qwen uses OpenAI-compatible API
    "deepseek": "deepseek",
    "deepseek_for_cc": "",  # No prefix — custom_llm_provider handles adapter selection
    "google": "gemini",
    "vertex_ai": "vertex_ai",
    "mistral": "mistral",
    "groq": "groq",
    "cohere": "cohere",
    "bedrock": "bedrock",
    "together_ai": "together_ai",
    "perplexity": "perplexity",
    "xai": "xai",
    "ollama": "ollama",
    "openrouter": "openrouter",
    "huggingface": "huggingface",
    "replicate": "replicate",
    "custom": "",                # User types full model path (e.g., "openai/gpt-4o")
}

PROVIDER_DEFAULT_BASE: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "qwen": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "deepseek_for_cc": "https://api.deepseek.com/anthropic",
    "mistral": "https://api.mistral.ai/v1",
    "groq": "https://api.groq.com/openai/v1",
    "cohere": "https://api.cohere.com/v1",
    "together_ai": "https://api.together.xyz/v1",
    "perplexity": "https://api.perplexity.ai",
    "xai": "https://api.x.ai/v1",
    "ollama": "http://localhost:11434/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}

# Provider → custom_llm_provider override (decouples model prefix from adapter)
# When set, LiteLLM uses the specified adapter regardless of the model prefix.
# E.g., deepseek_for_cc has model prefix "deepseek/" but uses Anthropic adapter
# because the endpoint (https://api.deepseek.com/anthropic) expects Anthropic format.
PROVIDER_CUSTOM_LLM_PROVIDER: dict[str, str] = {
    "deepseek_for_cc": "anthropic",
}

# ── Auth helper ──────────────────────────────────────────────────────


def _is_admin(user_claims: dict) -> bool:
    """Check if the user belongs to the 'admins' group."""
    groups = user_claims.get("groups", [])
    return "admins" in groups


def _require_admin(user_claims: dict = Depends(get_current_user)) -> dict:
    """Dependency — raises 403 if user is not an admin."""
    if not _is_admin(user_claims):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only system administrators can access this endpoint",
        )
    return user_claims


# ── Schemas ──────────────────────────────────────────────────────────


class ModelAddRequest(BaseModel):
    """Simplified payload for IT admins to add a new LLM model."""
    model_name: str = Field(..., description="Display name", examples=["gpt-4o"])
    provider: str = Field(..., description="Provider: openai / qwen / anthropic / azure", examples=["openai"])
    model_id: str = Field(..., description="Provider model ID", examples=["gpt-4o"])
    api_key: str = Field(..., description="API key from the provider")
    api_base: str | None = Field(default=None, description="Custom API base URL")
    rpm: int | None = Field(default=None, description="Requests per minute limit")
    tpm: int | None = Field(default=None, description="Tokens per minute limit")


class ModelUpdateRequest(BaseModel):
    """Partial update — all fields optional."""
    model_name: str | None = Field(default=None, description="New display name")
    api_key: str | None = Field(default=None, description="New provider API key")
    api_base: str | None = Field(default=None, description="New API base URL")
    rpm: int | None = Field(default=None, description="Requests per minute limit")
    tpm: int | None = Field(default=None, description="Tokens per minute limit")


class ModelSummary(BaseModel):
    """Summary returned to the admin UI (no secret key)."""
    id: str
    model_name: str
    provider: str = ""
    model_id: str = ""
    api_base: str | None = None
    rpm: int | None = None
    tpm: int | None = None

    model_config = {"from_attributes": True}


class ModelListResponse(BaseModel):
    models: list[ModelSummary]


# ── Helpers ──────────────────────────────────────────────────────────


def _build_litellm_model(provider: str, model_id: str) -> str:
    """Build the litellm model identifier, e.g. 'openai/gpt-4o'.

    For 'custom' provider, model_id is used directly (user types full path).
    """
    if provider == "custom":
        # User provides the full path, e.g. "openai/gpt-4o"
        return model_id
    prefix = PROVIDER_PREFIX.get(provider, provider)
    if prefix:
        return f"{prefix}/{model_id}"
    return model_id


def _resolve_api_base(provider: str, api_base: str | None) -> str | None:
    """Resolve API base — explicit value wins, then provider default."""
    if api_base:
        return api_base
    return PROVIDER_DEFAULT_BASE.get(provider)


def _parse_model_info(data: dict) -> ModelSummary:
    """Parse a LiteLLM /model/info entry into a ModelSummary."""
    model_name = data.get("model_name", "unknown")
    litellm_params = data.get("litellm_params", {}) or {}
    model_info = data.get("model_info", {}) or {}

    model_full = litellm_params.get("model", model_name)
    provider = ""
    model_id = model_full
    if "/" in model_full:
        provider, model_id = model_full.split("/", 1)

    return ModelSummary(
        id=model_info.get("id", model_name),
        model_name=model_name,
        provider=provider,
        model_id=model_id,
        api_base=litellm_params.get("api_base"),
        rpm=litellm_params.get("rpm"),
        tpm=litellm_params.get("tpm"),
    )


# ── Endpoints ────────────────────────────────────────────────────────


@router.get("/models", response_model=ModelListResponse)
async def list_models(user: dict = Depends(_require_admin)):
    """List all configured LLM models."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{settings.LITELLM_BASE_URL}/model/info",
            headers={"Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}"},
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LiteLLM model list failed: {resp.text}",
            )

        data = resp.json()
        entries = data.get("data", [])

    return ModelListResponse(
        models=[_parse_model_info(e) for e in entries]
    )


@router.post("/models", status_code=status.HTTP_201_CREATED)
async def add_model(body: ModelAddRequest, user: dict = Depends(_require_admin)):
    """Add a new LLM model with provider API key."""
    litellm_model = _build_litellm_model(body.provider, body.model_id)
    api_base = _resolve_api_base(body.provider, body.api_base)

    litellm_params: dict = {
        "model": litellm_model,
        "api_key": body.api_key,
    }
    if api_base:
        litellm_params["api_base"] = api_base
    if body.rpm is not None:
        litellm_params["rpm"] = body.rpm
    if body.tpm is not None:
        litellm_params["tpm"] = body.tpm

    # Override the provider adapter when the endpoint format differs
    # from what the model prefix implies (e.g., deepseek_for_cc uses
    # Anthropic-compatible endpoint but keeps deepseek/ model prefix).
    custom_provider = PROVIDER_CUSTOM_LLM_PROVIDER.get(body.provider)
    if custom_provider:
        litellm_params["custom_llm_provider"] = custom_provider

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.LITELLM_BASE_URL}/model/new",
            json={
                "model_name": body.model_name,
                "litellm_params": litellm_params,
                "model_info": {
                    "description": f"Managed via admin UI — provider: {body.provider}"
                },
            },
            headers={
                "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                "Content-Type": "application/json",
            },
        )

        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LiteLLM model creation failed: {resp.text}",
            )

    return {"status": "created", "model_name": body.model_name}


@router.put("/models/{model_id}")
async def update_model(
    model_id: str,
    body: ModelUpdateRequest,
    user: dict = Depends(_require_admin),
):
    """Update an existing model — change its API key, name, or limits."""
    litellm_params: dict = {}
    if body.api_key is not None:
        litellm_params["api_key"] = body.api_key
    if body.api_base is not None:
        litellm_params["api_base"] = body.api_base
    if body.rpm is not None:
        litellm_params["rpm"] = body.rpm
    if body.tpm is not None:
        litellm_params["tpm"] = body.tpm

    payload: dict = {}
    if body.model_name is not None:
        payload["model_name"] = body.model_name
    if litellm_params:
        payload["litellm_params"] = litellm_params

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.patch(
            f"{settings.LITELLM_BASE_URL}/model/{model_id}/update",
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                "Content-Type": "application/json",
            },
        )

        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LiteLLM model update failed: {resp.text}",
            )

    return {"status": "updated", "model_id": model_id}


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: str,
    user: dict = Depends(_require_admin),
):
    """Delete a model configuration."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{settings.LITELLM_BASE_URL}/model/delete",
            json={"id": model_id},
            headers={
                "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                "Content-Type": "application/json",
            },
        )

        if resp.status_code not in (200, 201, 204):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LiteLLM model deletion failed: {resp.text}",
            )


# ── Platform Settings ──────────────────────────────────────────────────


DEFAULT_SETTINGS: dict[str, str] = {
    "litellm_public_url": settings.LITELLM_PUBLIC_URL,
}


class PlatformSettingsResponse(BaseModel):
    """All platform settings as a flat key-value map."""
    settings: dict[str, str]


class PlatformSettingUpdateRequest(BaseModel):
    """Update a single platform setting."""
    key: str = Field(..., description="Setting key")
    value: str = Field(..., description="New value")


async def _get_setting(session: AsyncSession, key: str) -> str:
    """Read a setting from DB, falling back to env default."""
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == key)
    )
    row = result.scalar_one_or_none()
    if row and row.value:
        return row.value
    return DEFAULT_SETTINGS.get(key, "")


@router.get("/settings", response_model=PlatformSettingsResponse)
async def get_settings(
    user: dict = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Get all platform settings (admin-only)."""
    result = {}
    for key in DEFAULT_SETTINGS:
        result[key] = await _get_setting(session, key)
    return PlatformSettingsResponse(settings=result)


@router.put("/settings", status_code=status.HTTP_200_OK)
async def update_setting(
    body: PlatformSettingUpdateRequest,
    user: dict = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Update a platform setting (admin-only)."""
    if body.key not in DEFAULT_SETTINGS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown setting key: {body.key}",
        )

    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == body.key)
    )
    row = result.scalar_one_or_none()

    if row:
        row.value = body.value
    else:
        row = PlatformSetting(key=body.key, value=body.value)
        session.add(row)

    await session.commit()
    return {"status": "updated", "key": body.key, "value": body.value}
