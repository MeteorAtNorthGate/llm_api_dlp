"""Explore all relevant LiteLLM spend/log endpoints to find detailed per-request logs.

Usage:
    python test_litellm/explore_endpoints.py
"""

import os
import sys

import httpx

LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-master-key-change-me")

HEADERS = {
    "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
}


def try_endpoint(
    client: httpx.Client,
    method: str,
    path: str,
    params: dict | None = None,
    json_body: dict | None = None,
) -> None:
    """Try an endpoint and print status + first 500 chars of response."""
    url = f"{LITELLM_BASE_URL}{path}"
    label = f"{method} {path}"
    if params:
        label += f" params={params}"

    try:
        if method == "GET":
            resp = client.get(url, params=params, headers=HEADERS, timeout=15.0)
        elif method == "POST":
            resp = client.post(url, params=params, json=json_body, headers=HEADERS, timeout=15.0)
        else:
            return

        body = resp.text[:800]
        print(f"\n{'─' * 60}")
        print(f"  {label}")
        print(f"  Status: {resp.status_code}  |  Len: {len(resp.content)} bytes")
        print(f"  {body}")
        if len(resp.text) > 800:
            print(f"  ... (truncated, total {len(resp.content)} bytes)")

        # Try to parse and show structure
        if resp.status_code == 200:
            try:
                data = resp.json()
                if isinstance(data, list):
                    print(f"  → list[{len(data)}]")
                    if data:
                        print(f"  → first keys: {list(data[0].keys())}")
                elif isinstance(data, dict):
                    print(f"  → dict, keys: {list(data.keys())}")
                    for k, v in data.items():
                        if isinstance(v, list):
                            print(f"    {k}: list[{len(v)}]")
                            if v:
                                if isinstance(v[0], dict):
                                    print(f"      first keys: {list(v[0].keys())}")
            except Exception:
                pass
    except Exception as e:
        print(f"\n  {label}")
        print(f"  ERROR: {e}")


def main() -> None:
    print("Exploring LiteLLM Spend & Log Endpoints")
    print(f"Base URL: {LITELLM_BASE_URL}")

    today = "2026-06-12"
    month_ago = "2026-05-13"

    with httpx.Client(timeout=15.0) as client:
        # ── Global spend endpoints ──────────────────────────────────
        try_endpoint(client, "GET", "/global/spend/logs",
                     params={"start_date": month_ago, "end_date": today})
        try_endpoint(client, "GET", "/global/spend/logs",
                     params={"start_date": month_ago, "end_date": today, "api_key": "dummy"})
        try_endpoint(client, "GET", "/global/spend/keys",
                     params={"start_date": month_ago, "end_date": today})
        try_endpoint(client, "GET", "/global/spend/keys",
                     params={"start_date": month_ago, "end_date": today, "page": 1, "page_size": 5})
        try_endpoint(client, "GET", "/global/spend/logs/v2")

        # ── Per-key spend ───────────────────────────────────────────
        try_endpoint(client, "GET", "/spend/logs",
                     params={"start_date": month_ago, "end_date": today})
        try_endpoint(client, "GET", "/spend/keys",
                     params={"start_date": month_ago, "end_date": today})
        try_endpoint(client, "GET", "/spend/tags")

        # ── Log endpoints (maybe more detail?) ──────────────────────
        try_endpoint(client, "GET", "/global/activity")
        try_endpoint(client, "GET", "/global/activity",
                     params={"start_date": month_ago, "end_date": today, "page": 1, "page_size": 3})

        # ── User / key management endpoints ─────────────────────────
        try_endpoint(client, "GET", "/user/daily/activity")
        try_endpoint(client, "GET", "/user/daily/activity",
                     params={"start_date": month_ago, "end_date": today, "page": 1, "page_size": 3})
        try_endpoint(client, "GET", "/user/daily/activity",
                     params={"start_date": month_ago, "end_date": today, "api_key": "dummy", "page": 1, "page_size": 3})

        # ── Spend per model ─────────────────────────────────────────
        try_endpoint(client, "GET", "/global/spend/bymodel")
        try_endpoint(client, "GET", "/global/spend/model_metrics")

        # ── Monthly spend ───────────────────────────────────────────
        try_endpoint(client, "GET", "/global/spend/monthly")

        # ── LiteLLM docs — check available routes ───────────────────
        try_endpoint(client, "GET", "/routes")
        try_endpoint(client, "GET", "/")

    print(f"\n{'=' * 60}")
    print("Done exploring.")


if __name__ == "__main__":
    main()
