"""Statistics API endpoints — token consumption analytics.

Queries LiteLLM's PostgreSQL database directly for daily-aggregated token
metrics from ``LiteLLM_DailyEndUserSpend``.  This replaces the older approach
of calling LiteLLM's ``/user/daily/activity`` HTTP API, which could not filter
by ``end_user`` (the ``"user"`` field in chat-completion request bodies).

Architecture
------------
- Admin page (/stats): one SQL query for per-api-key totals (maps to local
  users via the ``ApiKey`` table) + concurrent per-end-user queries for chat
  usage (attributed via the ``user`` field in chat requests, stored in
  ``end_user_id``).
- Per-user page (/stats/me, /stats/users/{user_id}): SQL queries filtered by
  ``end_user_id`` (web UI chat) plus per-``api_key`` queries (external
  developer usage).
"""

import asyncio
import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user, is_admin
from app.db.models.api_key import ApiKey
from app.db.models.user import User
from app.db.session import get_session, get_litellm_session
from app.schemas.statistics import (
    ApiKeyStats,
    DailyUsage,
    StatisticsResponse,
    UserStats,
    UserUsageResponse,
)

router = APIRouter()

# ── Helpers ──────────────────────────────────────────────────────────────

# LiteLLM internal / system keys that should never appear in user statistics.
_SYSTEM_KEY_IDS = frozenset({
    "litellm_proxy_master_key",
    "litellm-internal-health-check",
})


def _default_start_date() -> date:
    return date.today() - timedelta(days=30)


def _default_end_date() -> date:
    return date.today()


def _extract_tokens_from_metrics(metrics: dict[str, Any]) -> tuple[int, int, int]:
    """Return (cache_miss, cache_hit, output) from a metrics dict.

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


# ── SQL query helpers ────────────────────────────────────────────────────

async def _query_end_user_activity(
    session: AsyncSession,
    start_date: date,
    end_date: date,
    *,
    end_user_id: str | None = None,
    api_key: str | None = None,
) -> list[dict[str, Any]]:
    """Query ``LiteLLM_DailyEndUserSpend`` for daily-aggregated token metrics.

    Returns a list of ``{date, metrics: {prompt_tokens, completion_tokens,
    cache_read_input_tokens}}`` entries, compatible with the downstream
    aggregation logic.
    """
    conditions = ["date BETWEEN :start_date AND :end_date"]
    params: dict[str, Any] = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }

    if end_user_id:
        conditions.append("end_user_id = :end_user_id")
        params["end_user_id"] = end_user_id
    if api_key:
        conditions.append("api_key = :api_key")
        params["api_key"] = api_key

    where_clause = " AND ".join(conditions)

    query = text(f"""
        SELECT date,
               SUM(prompt_tokens)               AS prompt_tokens,
               SUM(completion_tokens)           AS completion_tokens,
               SUM(cache_read_input_tokens)     AS cache_read_input_tokens
        FROM "LiteLLM_DailyEndUserSpend"
        WHERE {where_clause}
        GROUP BY date
        ORDER BY date
    """)

    result = await session.execute(query, params)
    rows = result.fetchall()

    return [
        {
            "date": row.date,
            "metrics": {
                "prompt_tokens": row.prompt_tokens or 0,
                "completion_tokens": row.completion_tokens or 0,
                "cache_read_input_tokens": row.cache_read_input_tokens or 0,
            },
        }
        for row in rows
    ]


async def _query_api_key_breakdown(
    session: AsyncSession,
    start_date: date,
    end_date: date,
) -> dict[str, dict[str, int]]:
    """Query ``LiteLLM_DailyEndUserSpend`` for per-api-key token totals.

    Returns ``{api_key: {cache_miss, cache_hit, output}}``, excluding system
    keys.  The ``api_key`` values are token hashes that match
    ``ApiKey.litellm_key_id``.
    """
    query = text("""
        SELECT api_key,
               SUM(prompt_tokens)               AS prompt_tokens,
               SUM(completion_tokens)           AS completion_tokens,
               SUM(cache_read_input_tokens)     AS cache_read_input_tokens
        FROM "LiteLLM_DailyEndUserSpend"
        WHERE date BETWEEN :start_date AND :end_date
          AND api_key NOT IN ('litellm_proxy_master_key', 'litellm-internal-health-check')
        GROUP BY api_key
    """)

    result = await session.execute(query, {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    })
    rows = result.fetchall()

    key_tokens: dict[str, dict[str, int]] = {}
    for row in rows:
        prompt = row.prompt_tokens or 0
        cache_hit = row.cache_read_input_tokens or 0
        completion = row.completion_tokens or 0
        cache_miss = max(prompt - cache_hit, 0)
        key_tokens[row.api_key] = {
            "cache_miss": cache_miss,
            "cache_hit": cache_hit,
            "output": completion,
        }

    return key_tokens


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("", response_model=StatisticsResponse)
async def get_statistics(
    start_date: date = Query(default_factory=_default_start_date),
    end_date: date = Query(default_factory=_default_end_date),
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    litellm_session: AsyncSession = Depends(get_litellm_session),
):
    """Admin: aggregated token consumption for all users and API keys.

    Strategy (hybrid):
    1. One SQL query → per-API-key totals from ``LiteLLM_DailyEndUserSpend``.
    2. Concurrent per-end-user queries → chat usage.
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
    id_to_user: dict[uuid.UUID, User] = {u.id: u for u in all_users}

    api_keys_result = await session.execute(select(ApiKey))
    all_api_keys: list[ApiKey] = api_keys_result.scalars().all()

    # ── 1. SQL query → per-API-key attribution ───────────────────────────
    key_tokens = await _query_api_key_breakdown(litellm_session, start_date, end_date)

    # ── 2. Per-user queries (concurrent) → chat usage ────────────────────
    async def _fetch_one_user(user: User) -> tuple[User, list[dict[str, Any]]]:
        """Fetch daily activity for a single user by end_user_id (keycloak_sub)."""
        entries = await _query_end_user_activity(
            litellm_session,
            start_date,
            end_date,
            end_user_id=user.keycloak_sub,
        )
        return user, entries

    user_tasks = [_fetch_one_user(u) for u in all_users]
    per_user_results: list[tuple[User, list[dict[str, Any]]]] = (
        await asyncio.gather(*user_tasks)
    )

    # user_id → {cache_miss, cache_hit, output}  (chat usage)
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

    # ── 3. Merge: build UserStats list ───────────────────────────────────
    user_stats_list: list[UserStats] = []
    grand_total = 0

    for user in all_users:
        # Chat (direct) usage from per-user end_user_id query
        chat = user_chat_tokens.get(user.id, {"cache_miss": 0, "cache_hit": 0, "output": 0})
        chat_total = chat["cache_miss"] + chat["cache_hit"] + chat["output"]

        # API keys owned by this user (from api_key breakdown)
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
    litellm_session: AsyncSession = Depends(get_litellm_session),
):
    """Current user's token usage with daily breakdown for chart."""
    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must be on or before end_date",
        )

    user = await _get_or_create_user(session, user_claims)
    return await _build_user_usage(
        session, litellm_session, target_user=user,
        start_date=start_date, end_date=end_date,
    )


@router.get("/users/{user_id}", response_model=UserUsageResponse)
async def get_user_usage(
    user_id: uuid.UUID,
    start_date: date = Query(default_factory=_default_start_date),
    end_date: date = Query(default_factory=_default_end_date),
    user_claims: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    litellm_session: AsyncSession = Depends(get_litellm_session),
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

    return await _build_user_usage(
        session, litellm_session, target_user=target_user,
        start_date=start_date, end_date=end_date,
    )


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
    litellm_session: AsyncSession,
    target_user: User,
    start_date: date,
    end_date: date,
) -> UserUsageResponse:
    """Build a UserUsageResponse — daily breakdown + summary for one user.

    1. ``LiteLLM_DailyEndUserSpend`` WHERE ``end_user_id = <keycloak_sub>``
       → direct chat usage
    2. ``LiteLLM_DailyEndUserSpend`` WHERE ``api_key = <litellm_key_id>``
       → external key usage (one query per key owned by this user)
    3. Merge daily maps from both sources.
    """

    # 1. Direct usage (web UI chat — attributed via ``end_user_id``)
    user_entries = await _query_end_user_activity(
        litellm_session,
        start_date,
        end_date,
        end_user_id=target_user.keycloak_sub,
    )

    # 2. API key usage (external developer calls)
    api_keys_result = await session.execute(
        select(ApiKey).where(ApiKey.user_id == target_user.id)
    )
    all_entries = list(user_entries)  # shallow copy
    for ak in api_keys_result.scalars().all():
        key_entries = await _query_end_user_activity(
            litellm_session,
            start_date,
            end_date,
            api_key=ak.litellm_key_id,
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
