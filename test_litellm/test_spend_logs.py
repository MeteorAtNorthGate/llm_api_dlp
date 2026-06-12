"""Test LiteLLM /global/spend/logs response format.

直接调 LiteLLM API，打印原始响应结构，用于排查 statistics 拉不到数据的问题。

Usage:
    cd /home/northengate/projects/llm_api_dlp
    python test_litellm/test_spend_logs.py
"""

import os
import sys
from datetime import date, timedelta

import httpx

# ── Config (与 apps/api-server/.env 保持一致) ──────────────────────────

LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-master-key-change-me")

HEADERS = {
    "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
}


def print_separator(title: str) -> None:
    print(f"\n{'=' * 70}")
    print(f"  {title}")
    print(f"{'=' * 70}")


def fetch_and_inspect(
    client: httpx.Client,
    url: str,
    params: dict,
    label: str,
) -> None:
    """发起 GET 请求并打印完整的响应诊断信息。"""
    print_separator(label)
    print(f"URL: {url}")
    print(f"Params: {params}")

    resp = client.get(url, params=params, headers=HEADERS)

    print(f"\nStatus: {resp.status_code}")
    print(f"Content-Type: {resp.headers.get('content-type', 'N/A')}")
    print(f"Content-Length: {len(resp.content)} bytes")

    # 打印前 3000 字符的原始响应体
    raw_text = resp.text
    print(f"\n--- Raw response (first 3000 chars) ---")
    print(raw_text[:3000])
    if len(raw_text) > 3000:
        print(f"... truncated, total {len(raw_text)} chars")

    # 尝试解析 JSON 并分析结构
    if resp.status_code == 200:
        try:
            body = resp.json()
            print(f"\n--- Parsed JSON structure ---")
            print(f"type: {type(body).__name__}")

            if isinstance(body, list):
                print(f"list length: {len(body)}")
                if body:
                    print(f"first element keys: {list(body[0].keys())}")
                    print(f"first element sample:")
                    _print_sample(body[0])
            elif isinstance(body, dict):
                print(f"dict keys: {list(body.keys())}")
                # 检查常见包裹字段
                for key in ("data", "results", "items", "logs", "entries"):
                    if key in body:
                        val = body[key]
                        if isinstance(val, list):
                            print(f"'{key}' is a list of length {len(val)}")
                            if val:
                                print(f"  first element keys: {list(val[0].keys())}")
                        else:
                            print(f"'{key}' type: {type(val).__name__}")
                # 如果没有这些键，打印所有 value 的类型
                if not any(k in body for k in ("data", "results", "items", "logs", "entries")):
                    for k, v in body.items():
                        if isinstance(v, list):
                            print(f"'{k}': list[{len(v)}]")
                        else:
                            print(f"'{k}': {type(v).__name__} = {repr(v)[:200]}")
            else:
                print(f"Unexpected type: {type(body).__name__}")
                print(repr(body)[:500])
        except Exception as e:
            print(f"JSON parse error: {e}")
    else:
        print(f"\nNon-200 response — 可能 LiteLLM 未运行或路由错误")


def _print_sample(obj: dict, indent: int = 2) -> None:
    """打印 dict 中每个 key 的 value 类型和示例值。"""
    prefix = " " * indent
    for k, v in obj.items():
        if isinstance(v, str) and len(v) > 120:
            print(f"{prefix}{k}: str[{len(v)}] = {v[:120]}...")
        elif isinstance(v, (list, dict)):
            print(f"{prefix}{k}: {type(v).__name__}[{len(v)}]")
            if isinstance(v, dict) and v:
                # 递归打印内层 dict 的前几个键
                for ik in list(v.keys())[:3]:
                    iv = v[ik]
                    if isinstance(iv, str) and len(iv) > 80:
                        iv = iv[:80] + "..."
                    print(f"{prefix}  {ik}: {type(iv).__name__} = {repr(iv)[:100]}")
        else:
            print(f"{prefix}{k}: {type(v).__name__} = {repr(v)}")


def main() -> None:
    print("LiteLLM Spend Logs — 响应格式诊断")
    print(f"Base URL: {LITELLM_BASE_URL}")
    print(f"Master Key: {'***' if LITELLM_MASTER_KEY else '(empty)'}")

    today = date.today()
    thirty_days_ago = today - timedelta(days=30)

    with httpx.Client(timeout=30.0) as client:
        # ── 1. 健康检查 ──────────────────────────────────────────────
        print_separator("1. LiteLLM 健康检查")
        try:
            resp = client.get(
                f"{LITELLM_BASE_URL}/health",
                headers=HEADERS,
            )
            print(f"Status: {resp.status_code}")
            print(f"Body: {resp.text[:500]}")
        except Exception as e:
            print(f"连接失败: {e}")
            print("请确认 LiteLLM 容器已启动 (make dev-infra)")
            sys.exit(1)

        # ── 2. 无参数请求 (LiteLLM 默认行为) ────────────────────────
        fetch_and_inspect(
            client,
            f"{LITELLM_BASE_URL}/global/spend/logs",
            params={},
            label="2. GET /global/spend/logs (无参数)",
        )

        # ── 3. 带日期范围 — 最近 30 天 ──────────────────────────────
        fetch_and_inspect(
            client,
            f"{LITELLM_BASE_URL}/global/spend/logs",
            params={
                "start_date": thirty_days_ago.isoformat(),
                "end_date": today.isoformat(),
            },
            label="3. GET /global/spend/logs (最近30天)",
        )

        # ── 4. 带 page + page_size 参数 ─────────────────────────────
        fetch_and_inspect(
            client,
            f"{LITELLM_BASE_URL}/global/spend/logs",
            params={
                "start_date": thirty_days_ago.isoformat(),
                "end_date": today.isoformat(),
                "page": 1,
                "page_size": 5,
            },
            label="4. GET /global/spend/logs (带分页: page=1, page_size=5)",
        )

        # ── 5. 带 user_id 过滤 ──────────────────────────────────────
        fetch_and_inspect(
            client,
            f"{LITELLM_BASE_URL}/global/spend/logs",
            params={
                "start_date": thirty_days_ago.isoformat(),
                "end_date": today.isoformat(),
                "page_size": 3,
            },
            label="5. GET /global/spend/logs (page_size=3, 验证翻页边界)",
        )

        # ── 6. 尝试带 api_key 过滤 ──────────────────────────────────
        fetch_and_inspect(
            client,
            f"{LITELLM_BASE_URL}/global/spend/logs",
            params={
                "start_date": thirty_days_ago.isoformat(),
                "end_date": today.isoformat(),
                "api_key": "nonexistent-test-key",
            },
            label="6. GET /global/spend/logs (带 api_key 过滤 — 空结果)",
        )

    print_separator("诊断完成")
    print("\n关键判断点:")
    print("  1. 响应是 list 还是 dict?")
    print("  2. 如果是 dict, 数据在哪个 key 下? (data/results/...)")
    print("  3. 分页时响应格式是否一致?")
    print("  4. 每条 entry 的 user_id 字段格式是什么?(与 keycloak_sub 是否匹配)")
    print("  5. 每条 entry 的 api_key 字段格式是什么?(与 litellm_key_id 是否匹配)")


if __name__ == "__main__":
    main()
