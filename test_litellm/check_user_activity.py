"""Check /user/daily/activity with various filter params to confirm API behavior.

Usage:
    python test_litellm/check_user_activity.py
"""

import os
import sys
import json

import httpx

LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-master-key-change-me")
HEADERS = {"Authorization": f"Bearer {LITELLM_MASTER_KEY}"}

today = "2026-06-12"
month_ago = "2026-05-13"


def call(path: str, params: dict, label: str) -> None:
    url = f"{LITELLM_BASE_URL}{path}"
    print(f"\n{'─' * 60}")
    print(f"  {label}")
    print(f"  {url}?{'&'.join(f'{k}={v}' for k,v in params.items())}")

    with httpx.Client(timeout=15.0) as client:
        resp = client.get(url, params=params, headers=HEADERS)
        print(f"  Status: {resp.status_code}")

        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict):
                # Show metadata
                meta = data.get("metadata", {})
                if meta:
                    print(f"  Metadata: {json.dumps(meta, indent=2)}")
                results = data.get("results", data.get("data", []))
                print(f"  Results count: {len(results)}")
                if results:
                    r = results[0]
                    print(f"  First result keys: {list(r.keys())}")
                    m = r.get("metrics", {})
                    if m:
                        print(f"  Metrics: {json.dumps(m, indent=2)}")
                    # Show breakdown structure
                    bd = r.get("breakdown", {})
                    if bd:
                        models = bd.get("models", {})
                        for mname, mdata in list(models.items())[:1]:
                            print(f"  Model '{mname}':")
                            akb = mdata.get("api_key_breakdown", {})
                            for kid, kdata in list(akb.items())[:3]:
                                print(f"    key={kid[:30]}... → {json.dumps(kdata.get('metrics', {}))}")
            elif isinstance(data, list):
                print(f"  List length: {len(data)}")
                if data:
                    print(f"  First keys: {list(data[0].keys())}")
        else:
            print(f"  Body: {resp.text[:500]}")


def main():
    print("/user/daily/activity — filter parameter tests")

    # Base call (no user_id)
    call("/user/daily/activity",
         {"start_date": month_ago, "end_date": today, "page": 1, "page_size": 2},
         "1. Base (no user_id)")

    # With user_id filter
    call("/user/daily/activity",
         {"start_date": month_ago, "end_date": today, "user_id": "test-user-sub",
          "page": 1, "page_size": 2},
         "2. With user_id=test-user-sub")

    # With user_id that exists (from Keycloak claims format - we need to check what users
    # actually exist in LiteLLM's spend data)
    call("/user/daily/activity",
         {"start_date": month_ago, "end_date": today, "user_id": "default_user_id",
          "page": 1, "page_size": 2},
         "3. With user_id=default_user_id")

    # Try to see what user_id values appear in /spend/logs
    call("/spend/logs",
         {"start_date": month_ago, "end_date": today},
         "4. /spend/logs — check user_id values in response")

    # Also check if there's a /user/daily/activity endpoint without the /user prefix
    call("/global/daily/activity",
         {"start_date": month_ago, "end_date": today, "page": 1, "page_size": 2},
         "5. /global/daily/activity (does this exist?)")

    # Check per-key activity
    call("/key/daily/activity",
         {"start_date": month_ago, "end_date": today, "page": 1, "page_size": 2},
         "6. /key/daily/activity (does this exist?)")

    print(f"\n{'=' * 60}")
    print("Conclusions:")
    print("  - /user/daily/activity = per-day token counts (prompt, completion, cache)")
    print("  - Response is paginated: {results: [...], metadata: {page, total_pages, has_more}}")
    print("  - Each result has: {date, metrics, breakdown}")
    print("  - Can it be filtered by user_id? Check above.")
    print("  - For admin stats page: need data for ALL users → use no user_id filter")
    print("  - For personal usage page: need single user → use user_id filter or api_key filter")


if __name__ == "__main__":
    main()
