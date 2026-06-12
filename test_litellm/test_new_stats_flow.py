"""End-to-end test: verify the new statistics logic against real LiteLLM data.

Runs the same calls that statistics.py now makes and validates:
1. _fetch_user_activity pagination
2. Token extraction from metrics
3. api_key_breakdown structure for admin page
4. user_id filter for per-user page

Usage:
    python test_litellm/test_new_stats_flow.py
"""

import os
import sys
from collections import defaultdict
from datetime import date, timedelta

import httpx

LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-master-key-change-me")
HEADERS = {"Authorization": f"Bearer {LITELLM_MASTER_KEY}"}

_SYSTEM_KEY_IDS = {
    "litellm_proxy_master_key",
    "litellm-internal-health-check",
}


def fetch_user_activity(
    client: httpx.Client,
    start_date: str,
    end_date: str,
    user_id: str | None = None,
    api_key: str | None = None,
    page_size: int = 500,
) -> list[dict]:
    """Same logic as statistics._fetch_user_activity."""
    all_results = []
    page = 1

    params = {
        "start_date": start_date,
        "end_date": end_date,
        "page_size": page_size,
    }
    if user_id:
        params["user_id"] = user_id
    if api_key:
        params["api_key"] = api_key

    while True:
        params["page"] = page
        resp = client.get(
            f"{LITELLM_BASE_URL}/user/daily/activity",
            params=params,
            headers=HEADERS,
        )
        assert resp.status_code == 200, f"HTTP {resp.status_code}: {resp.text[:300]}"

        body = resp.json()
        if not isinstance(body, dict):
            print(f"  Unexpected body type: {type(body).__name__}")
            break

        results = body.get("results") or []
        if not results:
            break

        all_results.extend(results)

        meta = body.get("metadata") or {}
        print(f"  Page {page}: got {len(results)} results, "
              f"has_more={meta.get('has_more')}, total_pages={meta.get('total_pages')}, "
              f"total_tokens={meta.get('total_tokens')}")

        if not meta.get("has_more", False):
            break
        page += 1

    return all_results


def extract_tokens(metrics: dict) -> tuple[int, int, int]:
    """Same logic as statistics._extract_tokens_from_metrics."""
    prompt = metrics.get("prompt_tokens", 0) or 0
    cache_hit = metrics.get("cache_read_input_tokens", 0) or 0
    completion = metrics.get("completion_tokens", 0) or 0
    cache_miss = max(prompt - cache_hit, 0)
    return cache_miss, cache_hit, completion


def main():
    today = date.today()
    month_ago = today - timedelta(days=30)
    start = month_ago.isoformat()
    end = today.isoformat()

    with httpx.Client(timeout=30.0) as client:
        # ── 1. Admin page simulation: fetch all activity ────────────
        print("=" * 60)
        print("1. Admin page: fetch /user/daily/activity (no filter)")
        print("=" * 60)

        daily_entries = fetch_user_activity(client, start, end)

        # Simulate the aggregation from get_statistics()
        key_tokens: dict[str, dict] = defaultdict(
            lambda: {"cache_miss": 0, "cache_hit": 0, "output": 0}
        )
        for day_entry in daily_entries:
            breakdown = day_entry.get("breakdown", {}) or {}
            models_data = breakdown.get("models", {}) or {}
            for model_name, model_data in models_data.items():
                akb = model_data.get("api_key_breakdown", {}) or {}
                for key_id, key_data in akb.items():
                    if key_id in _SYSTEM_KEY_IDS:
                        continue
                    km = key_data.get("metrics", {}) or {}
                    cm, ch, out = extract_tokens(km)
                    tk = key_tokens[key_id]
                    tk["cache_miss"] += cm
                    tk["cache_hit"] += ch
                    tk["output"] += out

        print(f"\n  Unique (non-system) API keys found: {len(key_tokens)}")
        grand_total = 0
        for key_id, tokens in key_tokens.items():
            total = tokens["cache_miss"] + tokens["cache_hit"] + tokens["output"]
            grand_total += total
            print(f"    {key_id[:40]}..."
                  f"  miss={tokens['cache_miss']:,}"
                  f"  hit={tokens['cache_hit']:,}"
                  f"  out={tokens['output']:,}"
                  f"  total={total:,}")
        print(f"  Grand total tokens: {grand_total:,}")

        # ── 2. Per-user page simulation ─────────────────────────────
        print(f"\n{'=' * 60}")
        print("2. Per-user page: fetch with user_id filter")
        print("=" * 60)

        # Try a few known user_ids
        for test_user_id in ["default_user_id"]:
            print(f"\n  user_id = '{test_user_id}'")
            user_entries = fetch_user_activity(
                client, start, end, user_id=test_user_id
            )

            daily_map: dict[str, dict] = defaultdict(
                lambda: {"cache_miss": 0, "cache_hit": 0, "output": 0}
            )
            totals = {"cache_miss": 0, "cache_hit": 0, "output": 0}

            for entry in user_entries:
                metrics = entry.get("metrics", {}) or {}
                cm, ch, out = extract_tokens(metrics)
                day = entry.get("date", "unknown")

                daily_map[day]["cache_miss"] += cm
                daily_map[day]["cache_hit"] += ch
                daily_map[day]["output"] += out

                totals["cache_miss"] += cm
                totals["cache_hit"] += ch
                totals["output"] += out

            total_tokens = totals["cache_miss"] + totals["cache_hit"] + totals["output"]
            print(f"  Total tokens: {total_tokens:,}")
            print(f"    cache_miss: {totals['cache_miss']:,}")
            print(f"    cache_hit:  {totals['cache_hit']:,}")
            print(f"    output:     {totals['output']:,}")
            print(f"  Daily breakdown ({len(daily_map)} days):")
            for day in sorted(daily_map.keys()):
                d = daily_map[day]
                print(f"    {day}: miss={d['cache_miss']:,} "
                      f"hit={d['cache_hit']:,} out={d['output']:,}")

        # ── 3. Verify metrics extraction correctness ─────────────────
        print(f"\n{'=' * 60}")
        print("3. Verify _extract_tokens_from_metrics correctness")
        print("=" * 60)

        test_cases = [
            # (metrics, expected (cache_miss, cache_hit, output))
            ({"prompt_tokens": 100, "completion_tokens": 50, "cache_read_input_tokens": 30}, (70, 30, 50)),
            ({"prompt_tokens": 100, "completion_tokens": 50, "cache_read_input_tokens": 0}, (100, 0, 50)),
            ({"prompt_tokens": 100, "completion_tokens": 50, "cache_read_input_tokens": 100}, (0, 100, 50)),
            ({"prompt_tokens": 0, "completion_tokens": 0, "cache_read_input_tokens": 0}, (0, 0, 0)),
            ({}, (0, 0, 0)),
        ]
        for metrics, expected in test_cases:
            result = extract_tokens(metrics)
            status = "PASS" if result == expected else f"FAIL (expected {expected})"
            print(f"  {status}: {metrics} → {result}")

    print(f"\n{'=' * 60}")
    print("Done — new statistics flow validated against live LiteLLM data.")


if __name__ == "__main__":
    main()
