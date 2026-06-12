"""Statistics API endpoints — token consumption analytics.

Queries LiteLLM's /global/spend/logs and aggregates data per user / API key.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user, is_admin
from app.db.models.api_key import ApiKey
from app.db.models.user import User
from app.db.session import get_session
from app.schemas.statistics import (
    ApiKeyStats,
    DailyUsage,
    StatisticsResponse,
    UserStats,
    UserUsageResponse,
)

router = APIRouter()

# ── Helpers ──────────────────────────────────────────────────────────────

LITELLM_PAGE_SIZE = 1000


def _default_start_date() -> date:
    """Default start date: 30 days ago."""
    return date.today() - timedelta(days=30)


def _default_end_date() -> date:
    """Default end date: today."""
    return date.today()


async def _fetch_spend_logs(
    start_date: date,
    end_date: date,
    user_id: str | None = None,
    api_key: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch ALL matching spend log entries from LiteLLM.

    Handles pagination by looping until no more entries are returned.
    Accepts optional user_id and api_key filters.
    """
    all_entries: list[dict[str, Any]] = []
    page = 1

    params: dict[str, Any] = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "page_size": LITELLM_PAGE_SIZE,
    }
    if user_id:
        params["user_id"] = user_id
    if api_key:
        params["api_key"] = api_key

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            params["page"] = page
            resp = await client.get(
                f"{settings.LITELLM_BASE_URL}/global/spend/logs",
                params=params,
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                },
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        f"LiteLLM spend/logs query failed "
                        f"(status {resp.status_code}): {resp.text[:500]}"
                    ),
                )

            data = resp.json()

            # LiteLLM may wrap entries in "data" or "results"
            entries = data.get("data") or data.get("results") or []
            if not entries:
                break

            all_entries.extend(entries)

            # Stop when we received fewer than the page size
            if len(entries) < LITELLM_PAGE_SIZE:
                break
            page += 1

    return all_entries


def _extract_tokens(entry: dict[str, Any]) -> tuple[int, int, int]:
    """Extract (cache_miss, cache_hit, output) token counts from a spend log entry."""
    prompt = entry.get("prompt_tokens", 0) or 0
    cache_hit = entry.get("cache_hit_tokens", 0) or 0
    completion = entry.get("completion_tokens", 0) or 0
    cache_miss = max(prompt - cache_hit, 0)
    return cache_miss, cache_hit, completion


def _safe_percent(numerator: int, denominator: int) -> float:
    """Compute percentage, returning 0.0 when denominator is zero."""
    if denominator == 0:
        return 0.0
    return round(numerator / denominator * 100, 1)


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("", response_model=StatisticsResponse)
async def get_statistics(
    start_date: date = Query(default_factory=_default_start_date),
    end_date: date = Query(default_factory=_default_end_date),
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Admin: aggregated token consumption for all users and API keys."""
    if not is_admin(user_claims):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can access statistics",
        )

    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must be on or before end_date",
        )

    # Fetch all spend logs for the date range (no filter — get everything)
    entries = await _fetch_spend_logs(start_date, end_date)

    # Load local users and API keys for mapping
    users_result = await session.execute(select(User))
    all_users: list[User] = users_result.scalars().all()
    sub_to_user: dict[str, User] = {u.keycloak_sub: u for u in all_users}

    api_keys_result = await session.execute(select(ApiKey))
    all_api_keys: list[ApiKey] = api_keys_result.scalars().all()
    token_to_key: dict[str, ApiKey] = {
        ak.litellm_key_id: ak for ak in all_api_keys
    }

    # Aggregate: user_id -> chat token dict  |  litellm_key_id -> key token dict
    user_chat_tokens: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cache_miss": 0, "cache_hit": 0, "output": 0}
    )
    key_tokens: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cache_miss": 0, "cache_hit": 0, "output": 0}
    )

    for entry in entries:
        cm, ch, out = _extract_tokens(entry)
        e_user_id = entry.get("user_id", "") or ""
        e_api_key = entry.get("api_key", "") or ""

        # Attribute: prefer API key when present AND known (more specific),
        # otherwise fall back to user_id.
        known_key = token_to_key.get(e_api_key)
        if known_key:
            tk = key_tokens[e_api_key]
            tk["cache_miss"] += cm
            tk["cache_hit"] += ch
            tk["output"] += out
        elif e_user_id:
            ut = user_chat_tokens[e_user_id]
            ut["cache_miss"] += cm
            ut["cache_hit"] += ch
            ut["output"] += out

    # Build UserStats list
    user_stats_list: list[UserStats] = []
    grand_total = 0

    # Collect all unique user subs from both chat and key ownership
    all_subs: set[str] = set(user_chat_tokens.keys())
    for ak in all_api_keys:
        if ak.litellm_key_id in key_tokens:
            owner = next(
                (u for u in all_users if u.id == ak.user_id), None
            )
            if owner:
                all_subs.add(owner.keycloak_sub)

    for sub in all_subs:
        user = sub_to_user.get(sub)
        username = user.username if user else sub
        email = user.email if user else None
        user_id = user.id if user else uuid.uuid4()

        chat = user_chat_tokens.get(sub, {"cache_miss": 0, "cache_hit": 0, "output": 0})
        chat_total = chat["cache_miss"] + chat["cache_hit"] + chat["output"]

        # Gather API keys owned by this user
        owned_keys = [ak for ak in all_api_keys if ak.user_id == user_id]
        api_key_stats_list: list[ApiKeyStats] = []

        user_total = chat_total

        for ak in owned_keys:
            kt = key_tokens.get(ak.litellm_key_id)
            if kt:
                kt_total = kt["cache_miss"] + kt["cache_hit"] + kt["output"]
                user_total += kt_total
                api_key_stats_list.append(
                    ApiKeyStats(
                        key_alias=ak.key_alias,
                        key_suffix=ak.key_suffix,
                        input_tokens_cache_miss=kt["cache_miss"],
                        input_tokens_cache_hit=kt["cache_hit"],
                        output_tokens=kt["output"],
                        total_tokens=kt_total,
                        token_percent=0.0,  # computed below
                    )
                )

        user_stats_list.append(
            UserStats(
                user_id=user_id,
                username=username,
                email=email,
                input_tokens_cache_miss=chat["cache_miss"],
                input_tokens_cache_hit=chat["cache_hit"],
                output_tokens=chat["output"],
                total_tokens=chat_total,  # chat only (keys are separate rows)
                token_percent=0.0,  # computed below
                api_keys=api_key_stats_list,
            )
        )
        grand_total += user_total

    # Compute percentages (per-row against grand total)
    for us in user_stats_list:
        us.token_percent = _safe_percent(us.total_tokens, grand_total)
        for aks in us.api_keys:
            aks.token_percent = _safe_percent(aks.total_tokens, grand_total)

    # Sort by total_tokens descending
    user_stats_list.sort(key=lambda u: u.total_tokens, reverse=True)

    return StatisticsResponse(
        users=user_stats_list,
        total_users=len(user_stats_list),
        grand_total_tokens=grand_total,
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
    )


@router.get("/me", response_model=UserUsageResponse)
async def get_my_usage(
    start_date: date = Query(default_factory=_default_start_date),
    end_date: date = Query(default_factory=_default_end_date),
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Current user's token usage with daily breakdown for chart."""
    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must be on or before end_date",
        )

    sub = user_claims.get("sub", "")

    # Get local user record
    user = await _get_or_create_user(session, user_claims)

    return await _build_user_usage(
        session=session,
        target_user=user,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/users/{user_id}", response_model=UserUsageResponse)
async def get_user_usage(
    user_id: uuid.UUID,
    start_date: date = Query(default_factory=_default_start_date),
    end_date: date = Query(default_factory=_default_end_date),
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Admin: view any user's usage. Non-admin: can only view self."""
    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must be on or before end_date",
        )

    # Fetch target user
    result = await session.execute(select(User).where(User.id == user_id))
    target_user = result.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Authorization: admin can view any; others only self
    requester_sub = user_claims.get("sub", "")
    if not is_admin(user_claims) and target_user.keycloak_sub != requester_sub:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own usage",
        )

    return await _build_user_usage(
        session=session,
        target_user=target_user,
        start_date=start_date,
        end_date=end_date,
    )


# ── Internal helpers ─────────────────────────────────────────────────────


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


async def _build_user_usage(
    session: AsyncSession,
    target_user: User,
    start_date: date,
    end_date: date,
) -> UserUsageResponse:
    """Build a UserUsageResponse for a given user — daily breakdown + summary."""

    # Fetch spend logs attributed to this user (chat usage via user_id)
    entries = await _fetch_spend_logs(
        start_date, end_date, user_id=target_user.keycloak_sub
    )

    # Fetch spend logs for each API key owned by this user
    api_keys_result = await session.execute(
        select(ApiKey).where(ApiKey.user_id == target_user.id)
    )
    for ak in api_keys_result.scalars().all():
        key_entries = await _fetch_spend_logs(
            start_date, end_date, api_key=ak.litellm_key_id
        )
        entries.extend(key_entries)

    # Aggregate by day + running totals
    daily_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cache_miss": 0, "cache_hit": 0, "output": 0}
    )
    totals = {"cache_miss": 0, "cache_hit": 0, "output": 0}

    for entry in entries:
        cm, ch, out = _extract_tokens(entry)
        ts = entry.get("startTime", "")
        day = ts[:10] if ts else "unknown"

        daily_map[day]["cache_miss"] += cm
        daily_map[day]["cache_hit"] += ch
        daily_map[day]["output"] += out

        totals["cache_miss"] += cm
        totals["cache_hit"] += ch
        totals["output"] += out

    # Build sorted daily list
    daily_usage = [
        DailyUsage(
            date=day,
            input_tokens_cache_miss=d["cache_miss"],
            input_tokens_cache_hit=d["cache_hit"],
            output_tokens=d["output"],
        )
        for day, d in sorted(daily_map.items())
    ]

    total_tokens = totals["cache_miss"] + totals["cache_hit"] + totals["output"]

    # Build summary (same shape as UserStats but token_percent is 100 for self-view)
    summary = UserStats(
        user_id=target_user.id,
        username=target_user.username,
        email=target_user.email,
        input_tokens_cache_miss=totals["cache_miss"],
        input_tokens_cache_hit=totals["cache_hit"],
        output_tokens=totals["output"],
        total_tokens=total_tokens,
        token_percent=100.0,  # meaningless for individual view
        api_keys=[],
    )

    return UserUsageResponse(
        user_id=target_user.id,
        username=target_user.username,
        email=target_user.email,
        daily_usage=daily_usage,
        summary=summary,
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
    )
