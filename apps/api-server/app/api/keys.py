"""Key management API endpoints — virtual API key generation and management."""

import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.db.models.api_key import ApiKey
from app.db.models.platform_setting import PlatformSetting
from app.db.models.user import User
from app.db.session import get_session
from app.schemas.keys import (
    KeyGenerateRequest,
    KeyGenerateResponse,
    KeySummary,
    KeyUsageResponse,
)

router = APIRouter()


async def _get_platform_setting(session: AsyncSession, key: str, default: str = "") -> str:
    """Read a platform setting from DB, falling back to the provided default."""
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == key)
    )
    row = result.scalar_one_or_none()
    if row and row.value:
        return row.value
    return default


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


def _is_developer(user_claims: dict) -> bool:
    """Check if the user belongs to the 'developers' group."""
    groups = user_claims.get("groups", [])
    return "developers" in groups


def _resolve_model_whitelist(user_claims: dict, requested_models: list[str] | None) -> list[str] | None:
    """Resolve model whitelist based on requested models.

    When developers specify models, the key is restricted to those models.
    When no models are specified, the key has access to ALL available models
    (the 'models' field is omitted from the LiteLLM payload entirely).
    """
    if requested_models:
        return requested_models
    # Default: no restriction — key can access all models
    return None


@router.get("", response_model=KeyUsageResponse)
async def list_keys(
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """List all API keys for the current user."""
    if not _is_developer(user_claims):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only developers can manage API keys",
        )

    user = await _get_or_create_user(session, user_claims)

    result = await session.execute(
        select(ApiKey)
        .where(ApiKey.user_id == user.id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()

    active_keys = [k for k in keys if k.is_active]
    summaries = [
        KeySummary(
            id=k.id,
            key_alias=k.key_alias,
            key_suffix=k.key_suffix,
            models=json.loads(k.model_whitelist) if k.model_whitelist else [],
            max_budget=k.max_budget,
            rpm_limit=k.rpm_limit,
            tpm_limit=k.tpm_limit,
            is_active=k.is_active,
            expires_at=k.expires_at,
            created_at=k.created_at,
        )
        for k in keys
    ]

    return KeyUsageResponse(
        total_keys=len(keys),
        active_keys=len(active_keys),
        total_spend_usd=0.0,  # Would query LiteLLM spend API in production
        keys=summaries,
    )


@router.post("/generate", response_model=KeyGenerateResponse, status_code=status.HTTP_201_CREATED)
async def generate_key(
    body: KeyGenerateRequest,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Generate a new virtual API key via LiteLLM Admin API."""
    if not _is_developer(user_claims):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only developers can generate API keys",
        )

    user = await _get_or_create_user(session, user_claims)
    model_whitelist = _resolve_model_whitelist(user_claims, body.models)

    expires_at = None
    if body.duration_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.duration_days)

    # Call LiteLLM Admin API to generate the virtual key
    litellm_payload: dict = {
        "key_alias": body.key_alias or f"key-{user.username}",
    }
    if model_whitelist:
        litellm_payload["models"] = model_whitelist
    # Only include limits when explicitly set — sending 0 to LiteLLM means "zero allowed"
    if body.max_budget is not None:
        litellm_payload["max_budget"] = body.max_budget
    if body.rpm_limit is not None:
        litellm_payload["rpm_limit"] = body.rpm_limit
    if body.tpm_limit is not None:
        litellm_payload["tpm_limit"] = body.tpm_limit

    if expires_at:
        litellm_payload["duration"] = f"{body.duration_days}d"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.LITELLM_BASE_URL}/key/generate",
            json=litellm_payload,
            headers={
                "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                "Content-Type": "application/json",
            },
        )

        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LiteLLM key generation failed: {resp.text}",
            )

        litellm_data = resp.json()

    api_key = litellm_data.get("key") or litellm_data.get("token", "")
    key_suffix = api_key[-4:] if len(api_key) >= 4 else "****"

    # Persist key metadata locally
    db_key = ApiKey(
        user_id=user.id,
        litellm_key_id=litellm_data.get("token_id", str(uuid.uuid4())),
        key_alias=body.key_alias,
        key_suffix=key_suffix,
        model_whitelist=json.dumps(model_whitelist) if model_whitelist else None,
        max_budget=body.max_budget,
        rpm_limit=body.rpm_limit,
        tpm_limit=body.tpm_limit,
        is_active=True,
        expires_at=expires_at,
    )
    session.add(db_key)
    await session.commit()
    await session.refresh(db_key)

    public_url = await _get_platform_setting(
        session, "litellm_public_url", settings.LITELLM_PUBLIC_URL
    )

    return KeyGenerateResponse(
        id=db_key.id,
        key_alias=db_key.key_alias,
        api_key=api_key,
        key_suffix=key_suffix,
        models=model_whitelist or [],
        max_budget=body.max_budget,
        expires_at=expires_at,
        created_at=db_key.created_at,
        base_url=public_url,
    )


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_key(
    key_id: str,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Revoke an API key — soft delete locally and attempt LiteLLM deletion."""
    if not _is_developer(user_claims):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only developers can revoke API keys",
        )

    user = await _get_or_create_user(session, user_claims)

    result = await session.execute(
        select(ApiKey).where(
            ApiKey.id == uuid.UUID(key_id),
            ApiKey.user_id == user.id,
        )
    )
    db_key = result.scalar_one_or_none()
    if db_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found",
        )

    # Try to delete from LiteLLM
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.LITELLM_BASE_URL}/key/delete",
                json={"keys": [db_key.litellm_key_id]},
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                    "Content-Type": "application/json",
                },
            )
    except Exception:
        pass  # Best effort — local state is authoritative

    db_key.is_active = False
    await session.commit()


@router.delete("/{key_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(
    key_id: str,
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Permanently delete an API key — remove from LiteLLM and hard-delete from Postgres."""
    if not _is_developer(user_claims):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only developers can delete API keys",
        )

    user = await _get_or_create_user(session, user_claims)

    result = await session.execute(
        select(ApiKey).where(
            ApiKey.id == uuid.UUID(key_id),
            ApiKey.user_id == user.id,
        )
    )
    db_key = result.scalar_one_or_none()
    if db_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found",
        )

    # Delete from LiteLLM first (best effort)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.LITELLM_BASE_URL}/key/delete",
                json={"keys": [db_key.litellm_key_id]},
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                    "Content-Type": "application/json",
                },
            )
    except Exception:
        pass  # Best effort — proceed with local hard-delete regardless

    # Hard-delete from local database
    await session.delete(db_key)
    await session.commit()
