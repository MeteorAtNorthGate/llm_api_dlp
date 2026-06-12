"""Diagnose: cross-reference local User.keycloak_sub with LiteLLM user_id.

Uses raw SQL to avoid ORM mapper issues, and direct HTTP to LiteLLM.

Usage:
    cd /home/northengate/projects/llm_api_dlp
    apps/api-server/.venv/bin/python test_litellm/diagnose_users.py
"""

import os
import sys
from datetime import date, timedelta

import httpx
import asyncpg

# ── Config ──────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://llmuser:llmpass@localhost:5432/llm_dlp")
LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-master-key-change-me")
HEADERS = {"Authorization": f"Bearer {LITELLM_MASTER_KEY}"}


def check_user_activity(client: httpx.Client, user_id: str,
                        start: str, end: str) -> dict:
    """Check if a user_id has activity in LiteLLM /user/daily/activity."""
    resp = client.get(
        f"{LITELLM_BASE_URL}/user/daily/activity",
        params={"start_date": start, "end_date": end,
                "user_id": user_id, "page_size": 1, "page": 1},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return {"error": f"HTTP {resp.status_code}"}
    data = resp.json()
    if not isinstance(data, dict):
        return {"error": f"unexpected type: {type(data).__name__}"}
    meta = data.get("metadata") or {}
    results = data.get("results") or []
    return {
        "total_tokens": meta.get("total_tokens", 0),
        "total_prompt": meta.get("total_prompt_tokens", 0),
        "total_completion": meta.get("total_completion_tokens", 0),
        "total_cache_read": meta.get("total_cache_read_input_tokens", 0),
        "total_requests": meta.get("total_api_requests", 0),
        "total_pages": meta.get("total_pages", 0),
        "days": len(results),
    }


def check_all_spend_users(client: httpx.Client, start: str, end: str) -> dict[str, float]:
    """Get all user_id values from /spend/logs."""
    resp = client.get(
        f"{LITELLM_BASE_URL}/spend/logs",
        params={"start_date": start, "end_date": end},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return {}
    data = resp.json()
    if not isinstance(data, list):
        return {}

    all_users: dict[str, float] = {}
    for entry in data:
        users = entry.get("users") or {}
        for uid, spend in users.items():
            all_users[uid] = all_users.get(uid, 0.0) + (spend or 0.0)
    return all_users


async def main():
    today = date.today()
    month_ago = today - timedelta(days=30)
    start = month_ago.isoformat()
    end = today.isoformat()

    print("=" * 70)
    print("  USER DIAGNOSIS — Local DB vs LiteLLM")
    print(f"  Date range: {start} → {end}")
    print("=" * 70)

    # ── 1. Query local users via raw SQL ─────────────────────────────
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch("SELECT id, keycloak_sub, username, email FROM users ORDER BY username")
        print(f"\n1. Local DB users ({len(rows)}):")
        for r in rows:
            sub = r['keycloak_sub']
            print(f"   id={r['id']}")
            print(f"     keycloak_sub = '{sub}'")
            print(f"     username     = '{r['username']}'")
            print(f"     email        = '{r['email']}'")

        # API keys
        key_rows = await conn.fetch("""
            SELECT ak.litellm_key_id, ak.key_alias, ak.key_suffix, ak.is_active, u.username
            FROM api_keys ak JOIN users u ON ak.user_id = u.id
            ORDER BY u.username
        """)
        print(f"\n   API keys ({len(key_rows)}):")
        for kr in key_rows:
            print(f"     litellm_key_id={kr['litellm_key_id'][:50]}..."
                  f"  alias={kr['key_alias']}  suffix={kr['key_suffix']}"
                  f"  owner={kr['username']}  active={kr['is_active']}")

        user_subs = {r['keycloak_sub']: r for r in rows}
    finally:
        await conn.close()

    # ── 2. Check each user against LiteLLM ─────────────────────────
    print(f"\n2. Per-user LiteLLM check (/user/daily/activity?user_id=<sub>):")
    with httpx.Client(timeout=30.0) as client:
        for r in rows:
            sub = r['keycloak_sub']
            info = check_user_activity(client, sub, start, end)
            if "error" in info:
                print(f"   ✗ ERROR  sub='{sub}'  {info['error']}")
            elif info["total_tokens"] > 0:
                print(f"   ✓ DATA   sub='{sub}'  "
                      f"tokens={info['total_tokens']:,}  "
                      f"prompt={info['total_prompt']:,}  "
                      f"completion={info['total_completion']:,}  "
                      f"cache_read={info['total_cache_read']:,}  "
                      f"requests={info['total_requests']}  "
                      f"days={info['days']}")
            else:
                print(f"   ✗ EMPTY  sub='{sub}'  "
                      f"(requests={info['total_requests']})")

        # ── 3. All user_ids known to LiteLLM ───────────────────────
        print(f"\n3. All user_ids in /spend/logs:")
        spend_users = check_all_spend_users(client, start, end)
        if spend_users:
            for uid, total_spend in sorted(spend_users.items(),
                                            key=lambda x: x[1], reverse=True):
                matched = uid in user_subs
                marker = "✓ MATCH" if matched else "✗ NO MATCH"
                print(f"   {marker}  user_id='{uid}'  spend={total_spend}")
        else:
            print("   (empty)")

        # Also try to find what user_id the admin has
        print(f"\n4. Try common admin user_id values:")
        for try_sub in ["admin", "administrator", "Admin"]:
            info = check_user_activity(client, try_sub, start, end)
            if "error" not in info and info["total_tokens"] > 0:
                print(f"   ✓ FOUND!  user_id='{try_sub}' → {info['total_tokens']:,} tokens")
            else:
                print(f"   ✗ user_id='{try_sub}' → no data")

    # ── 5. Summary ─────────────────────────────────────────────────
    print(f"\n{'=' * 70}")
    print("  DIAGNOSIS:")
    print("  If per-user EMPTY but spend data shows activity:")
    print("    keycloak_sub in local DB ≠ user_id in LiteLLM spend logs")
    print("    → need to check what chat.py line 233 passes as 'user'")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
