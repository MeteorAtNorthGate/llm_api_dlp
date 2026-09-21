#!/usr/bin/env python3
"""Replay a captured /v1/responses SSE stream through ResponsesStreamAdapter.

The adapter is pure (no HTTP, no DB, no config), so this needs nothing running
and makes no network calls — it is a regression test for the event-shape
handling, which is the part most likely to break when LiteLLM or DeepSeek
changes something.

Capture a fresh fixture:

    curl -N -sS "$LITELLM/v1/responses" \\
      -H "Authorization: Bearer $LITELLM_MASTER_KEY" \\
      -H 'Content-Type: application/json' \\
      -d '{"model":"ds-search","input":"今天有什么AI新闻","stream":true,
           "tools":[{"type":"web_search"}]}' > /tmp/sse.txt

Then:

    cd apps/api-server
    .venv/bin/python ../../test_litellm/replay_responses_stream.py /tmp/sse.txt

Exit code is non-zero if the stream produced no text, which would mean the
adapter failed to understand the event vocabulary it was given.
"""

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api-server"))

from app.services.responses_adapter import ResponsesStreamAdapter  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    adapter = ResponsesStreamAdapter()
    seen: Counter[str] = Counter()
    frames: Counter[str] = Counter()
    errors: list[str] = []
    done = False

    for raw in Path(sys.argv[1]).read_text(errors="replace").splitlines():
        # LiteLLM v1.87.1 sends no `event:` lines — the type lives in the JSON.
        # Tolerate them anyway in case a future version switches to OpenAI's
        # named-SSE format.
        if raw.startswith("event: "):
            continue
        if not raw.startswith("data: "):
            continue

        payload = raw[6:].strip()
        if payload == "[DONE]":
            done = True
            break

        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            continue

        seen[event.get("type", "<no type>")] += 1

        for frame in adapter.feed(event):
            if "error" in frame:
                errors.append(frame["error"])
            elif "search" in frame:
                frames["search"] += 1
            elif "content" in frame.get("choices", [{}])[0].get("delta", {}):
                frames["content"] += 1
            elif "reasoning_content" in frame.get("choices", [{}])[0].get("delta", {}):
                frames["reasoning"] += 1

    print(f"upstream events : {sum(seen.values())}")
    for name, count in seen.most_common():
        print(f"    {count:6}  {name}")
    print(f"\nemitted frames  : {dict(frames)}")
    print(f"[DONE] seen     : {done}")
    print(f"errors          : {errors or 'none'}")
    print(f"\nfull_content    : {len(adapter.full_content)} chars")
    print(f"full_reasoning  : {len(adapter.full_reasoning)} chars")
    print(f"model_name      : {adapter.model_name}")
    print(f"token_count     : {adapter.token_count}")
    print(f"searches        : {adapter.search_count}")
    print(f"queries         : {json.dumps(adapter.queries, ensure_ascii=False)}")
    print(f"sources         : {json.dumps(adapter.sources, ensure_ascii=False)}")
    print(f"in_progress     : {adapter.search_in_progress}")
    print(f"\nsearch_meta     : {json.dumps(adapter.as_search_meta(), ensure_ascii=False)}")
    print(f"\nanswer preview  : {adapter.full_content[:180]!r}")

    if errors:
        print("\nFAIL: upstream reported an error")
        return 1
    if not adapter.full_content:
        print("\nFAIL: no assistant text was recovered from this stream")
        return 1

    print("\nOK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
