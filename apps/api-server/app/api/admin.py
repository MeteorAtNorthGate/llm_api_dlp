"""System admin endpoints — manage LLM provider models and API keys.

Only users in the 'admins' Keycloak group can access these endpoints.
All operations proxy to LiteLLM's Admin API using the master key.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import get_current_user

router = APIRouter()

# ── Provider → litellm model prefix mapping ──────────────────────────

PROVIDER_PREFIX: dict[str, str] = {
    "openai": "openai",
    "qwen": "openai",          # Qwen uses OpenAI-compatible API
    "anthropic": "anthropic",
    "azure": "azure",
}

PROVIDER_DEFAULT_BASE: dict[str, str] = {
    "qwen": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "openai": "https://api.openai.com/v1",
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
    """Build the litellm model identifier, e.g. 'openai/gpt-4o'."""
    prefix = PROVIDER_PREFIX.get(provider, provider)
    return f"{prefix}/{model_id}"


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
