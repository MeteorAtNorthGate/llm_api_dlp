"""Statistics API endpoints — token consumption analytics.

Queries LiteLLM's /user/daily/activity endpoint which returns per-day token
metrics with per-model and per-API-key breakdowns (prompt_tokens,
completion_tokens, cache_read_input_tokens).  This replaces the older
/global/spend/logs endpoint which only returned date + spend aggregates.

Architecture
------------
- Admin page (/stats): hybrid — one global call for non-system-key breakdown
  (maps to users via ApiKey table) + concurrent per-user calls for chat usage
  (attributed via the ``user`` field in chat requests).
- Per-user page (/stats/me, /stats/users/{user_id}): direct call filtered by
  ``user_id`` (web UI chat) plus per-API-key calls (external developer usage).
"""

import asyncio
import uuid
from collections import defaultdict
from datetime import date, timedelta
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

LITELLM_PAGE_SIZE = 500

# LiteLLM internal / system keys that should never appear in user statistics.
_SYSTEM_KEY_IDS = frozenset({
    "litellm_proxy_master_key",
    "litellm-internal-health-check",
})


def _default_start_date() -> date:
    return date.today() - timedelta(days=30)


def _default_end_date() -> date:
    return date.today()


async def _fetch_user_activity(
    start_date: date,
    end_date: date,
    user_id: str | None = None,
    api_key: str | None = None,
    page_size: int = LITELLM_PAGE_SIZE,
) -> list[dict[str, Any]]:
    """Fetch ALL daily-activity entries from LiteLLM /user/daily/activity.

    Handles pagination by following ``metadata.has_more`` until exhausted.
    Returns the flat list of ``results`` entries across all pages.
    """
    all_results: list[dict[str, Any]] = []
    page = 1

    params: dict[str, Any] = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "page_size": page_size,
    }
    if user_id:
        params["user_id"] = user_id
    if api_key:
        params["api_key"] = api_key

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            params["page"] = page
            resp = await client.get(
                f"{settings.LITELLM_BASE_URL}/user/daily/activity",
                params=params,
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                },
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        f"LiteLLM /user/daily/activity query failed "
                        f"(status {resp.status_code}): {resp.text[:500]}"
                    ),
                )

            body = resp.json()
            if not isinstance(body, dict):
                break

            results = body.get("results") or []
            if not results:
                break

            all_results.extend(results)

            meta = body.get("metadata") or {}
            if not meta.get("has_more", False):
                break
            page += 1

    return all_results


def _extract_tokens_from_metrics(metrics: dict[str, Any]) -> tuple[int, int, int]:
    """Return (cache_miss, cache_hit, output) from a LiteLLM metrics dict.

    ``prompt_tokens`` is the total input; ``cache_read_input_tokens`` is the
    cached portion.  Cache-miss = prompt - cache_hit (≥ 0).
    """
    prompt = metrics.get("prompt_tokens", 0) or 0
    cache_hit = metrics.get("cache_read_input_tokens", 0) or 0
    completion = metrics.get("completion_tokens", 0) or 0
    cache_miss = max(prompt - cache_hit, 0)
    return cache_miss, cache_hit, completion


def _sum_metrics(metrics: dict[str, Any]) -> int:
    """Total tokens from a metrics dict (cache_miss + cache_hit + output)."""
    cm, ch, out = _extract_tokens_from_metrics(metrics)
    return cm + ch + out


def _safe_percent(numerator: int, denominator: int) -> float:
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
    """Admin: aggregated token consumption for all users and API keys.

    Strategy (hybrid):
    1. One global /user/daily/activity call → non-system-key breakdown.
    2. Concurrent per-user calls → chat usage attributed via ``user`` field.
    3. Merge: per-key totals from (1) + per-user totals from (2).
    """
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

    # ── Load local data ──────────────────────────────────────────────────
    users_result = await session.execute(select(User))
    all_users: list[User] = users_result.scalars().all()
    # Build lookup: user.id → User
    id_to_user: dict[uuid.UUID, User] = {u.id: u for u in all_users}

    api_keys_result = await session.execute(select(ApiKey))
    all_api_keys: list[ApiKey] = api_keys_result.scalars().all()
    # LiteLLM key-id → local ApiKey
    litellm_id_to_apikey: dict[str, ApiKey] = {
        ak.litellm_key_id: ak for ak in all_api_keys
    }

    # ── 1. Global call → non-system key attribution ─────────────────────
    global_entries = await _fetch_user_activity(start_date, end_date)

    # key_id → {cache_miss, cache_hit, output}
    key_tokens: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cache_miss": 0, "cache_hit": 0, "output": 0}
    )

    for day_entry in global_entries:
        models_data = (day_entry.get("breakdown") or {}).get("models") or {}
        for _model_name, model_data in models_data.items():
            akb = model_data.get("api_key_breakdown") or {}
            for key_id, key_data in akb.items():
                if key_id in _SYSTEM_KEY_IDS:
                    continue
                km = key_data.get("metrics") or {}
                cm, ch, out = _extract_tokens_from_metrics(km)
                tk = key_tokens[key_id]
                tk["cache_miss"] += cm
                tk["cache_hit"] += ch
                tk["output"] += out

    # ── 2. Per-user calls (concurrent) → chat usage ─────────────────────
    async def _fetch_one_user(user: User) -> tuple[User, list[dict[str, Any]]]:
        """Fetch daily activity for a single user (by keycloak_sub)."""
        entries = await _fetch_user_activity(
            start_date, end_date, user_id=user.keycloak_sub
        )
        return user, entries

    # Fire all per-user fetches concurrently
    user_tasks = [_fetch_one_user(u) for u in all_users]
    per_user_results: list[tuple[User, list[dict[str, Any]]]] = (
        await asyncio.gather(*user_tasks)
    )

    # user_id → {cache_miss, cache_hit, output}  (chat usage from per-user call)
    user_chat_tokens: dict[uuid.UUID, dict[str, int]] = {}
    for user, entries in per_user_results:
        totals = {"cache_miss": 0, "cache_hit": 0, "output": 0}
        for entry in entries:
            metrics = entry.get("metrics") or {}
            cm, ch, out = _extract_tokens_from_metrics(metrics)
            totals["cache_miss"] += cm
            totals["cache_hit"] += ch
            totals["output"] += out
        user_chat_tokens[user.id] = totals

    # ── 3. Merge: build UserStats list ──────────────────────────────────
    user_stats_list: list[UserStats] = []
    grand_total = 0

    for user in all_users:
        # Chat (direct) usage from per-user call
        chat = user_chat_tokens.get(user.id, {"cache_miss": 0, "cache_hit": 0, "output": 0})
        chat_total = chat["cache_miss"] + chat["cache_hit"] + chat["output"]

        # API keys owned by this user (from global api_key_breakdown)
        api_key_stats_list: list[ApiKeyStats] = []
        keys_total = 0

        for ak in all_api_keys:
            if ak.user_id != user.id:
                continue
            kt = key_tokens.get(ak.litellm_key_id)
            if kt is None:
                continue  # this key had no activity in the date range
            kt_total = kt["cache_miss"] + kt["cache_hit"] + kt["output"]
            keys_total += kt_total
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

        user_total = chat_total + keys_total
        grand_total += user_total

        user_stats_list.append(
            UserStats(
                user_id=user.id,
                username=user.username,
                email=user.email,
                input_tokens_cache_miss=chat["cache_miss"],
                input_tokens_cache_hit=chat["cache_hit"],
                output_tokens=chat["output"],
                total_tokens=user_total,
                token_percent=0.0,  # computed below
                api_keys=api_key_stats_list,
            )
        )

    # Compute percentages & sort
    for us in user_stats_list:
        us.token_percent = _safe_percent(us.total_tokens, grand_total)
        for aks in us.api_keys:
            aks.token_percent = _safe_percent(aks.total_tokens, grand_total)

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

    user = await _get_or_create_user(session, user_claims)
    return await _build_user_usage(session, target_user=user,
                                   start_date=start_date, end_date=end_date)


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

    result = await session.execute(select(User).where(User.id == user_id))
    target_user = result.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    requester_sub = user_claims.get("sub", "")
    if not is_admin(user_claims) and target_user.keycloak_sub != requester_sub:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own usage",
        )

    return await _build_user_usage(session, target_user=target_user,
                                   start_date=start_date, end_date=end_date)


# ── Internal helpers ─────────────────────────────────────────────────────


async def _get_or_create_user(session: AsyncSession, user_claims: dict) -> User:
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
    """Build a UserUsageResponse — daily breakdown + summary for one user.

    1. /user/daily/activity?user_id=<keycloak_sub>    → direct chat usage
    2. /user/daily/activity?api_key=<litellm_key_id>   → external key usage
       (one call per key owned by this user)
    3. Merge daily maps from both sources.
    """

    # 1. Direct usage (web UI chat — attributed via ``user`` field)
    user_entries = await _fetch_user_activity(
        start_date, end_date, user_id=target_user.keycloak_sub
    )

    # 2. API key usage (external developer calls)
    api_keys_result = await session.execute(
        select(ApiKey).where(ApiKey.user_id == target_user.id)
    )
    all_entries = list(user_entries)  # shallow copy
    for ak in api_keys_result.scalars().all():
        key_entries = await _fetch_user_activity(
            start_date, end_date, api_key=ak.litellm_key_id
        )
        all_entries.extend(key_entries)

    # Aggregate by day
    daily_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cache_miss": 0, "cache_hit": 0, "output": 0}
    )
    totals = {"cache_miss": 0, "cache_hit": 0, "output": 0}

    for entry in all_entries:
        metrics = entry.get("metrics") or {}
        cm, ch, out = _extract_tokens_from_metrics(metrics)
        day = entry.get("date", "unknown")

        daily_map[day]["cache_miss"] += cm
        daily_map[day]["cache_hit"] += ch
        daily_map[day]["output"] += out

        totals["cache_miss"] += cm
        totals["cache_hit"] += ch
        totals["output"] += out

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

    summary = UserStats(
        user_id=target_user.id,
        username=target_user.username,
        email=target_user.email,
        input_tokens_cache_miss=totals["cache_miss"],
        input_tokens_cache_hit=totals["cache_hit"],
        output_tokens=totals["output"],
        total_tokens=total_tokens,
        token_percent=100.0,
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
