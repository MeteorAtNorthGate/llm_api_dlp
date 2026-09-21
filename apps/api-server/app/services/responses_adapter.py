"""Translates LiteLLM's Responses-API SSE events into the chat-completions
shaped frames the web client already understands.

Why this exists: DeepSeek's ``web_search`` tool only works on DeepSeek's
``/v1/responses`` endpoint (see ``deepseek_responses_路由说明.md``), but the
browser's SSE reader is hardcoded to ``choices[0].delta``. Rather than teach the
frontend a second API vocabulary, the api-server adapts — it is already the
component that owns persistence, DLP and title generation for a turn.

Deliberately pure: no HTTP, no DB, no config.  That makes it replayable against
a captured stream, which is how it is tested (see ``test_litellm/``).

Event shapes below were captured from a live DeepSeek stream, not taken from
OpenAI's docs — they differ in ways that matter.  In particular the reasoning
delta is ``response.reasoning_text.delta``, NOT OpenAI's
``response.reasoning_summary_text.delta``; a parser written from the spec would
silently drop all reasoning.  Both spellings are accepted, because LiteLLM's
Responses→Chat *bridge* (taken by non-``deepseek_responses`` deployments) emits
the ``reasoning_summary_text`` spelling for the same upstream content.
"""

from typing import Any

# Frames the frontend's search panel understands.  Kept cumulative (see below).
SEARCH_KEY = "search"

_REASONING_DELTA_TYPES = (
    "response.reasoning_text.delta",
    "response.reasoning_summary_text.delta",
)


def _text_frame(text: str) -> dict:
    return {"choices": [{"delta": {"content": text}}]}


def _reasoning_frame(text: str) -> dict:
    return {"choices": [{"delta": {"reasoning_content": text}}]}


def _add_unique(target: list[str], items: list[str]) -> None:
    for item in items:
        if item and item not in target:
            target.append(item)


def parse_search_action(action: Any) -> tuple[list[str], list[str]]:
    """Split a ``web_search_call`` action into (queries, opened-page URLs).

    DeepSeek tags both shapes with an internal round-trip id that must not
    reach the UI: a junk trailing ``ws_call_id=...`` "query" and a
    ``#ws_call_id=...`` fragment on every opened URL.
    """
    if not isinstance(action, dict):
        return [], []

    action_type = action.get("type")
    if action_type == "search":
        queries = [
            q
            for q in (action.get("queries") or [])
            if isinstance(q, str) and not q.startswith("ws_call_id=")
        ]
        return queries, []

    if action_type == "open_page":
        url = (action.get("url") or "").split("#")[0]
        return [], [url] if url else []

    return [], []


def extract_completion(data: dict) -> tuple[str, str, dict | None]:
    """Pull (content, reasoning, search_meta) out of a non-streaming body.

    The non-streaming Responses shape differs from the streamed one — the
    reasoning text arrives whole, inside ``output[]`` items, rather than as
    deltas — so it gets its own extractor rather than a replay of the adapter.
    """
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    queries: list[str] = []
    sources: list[str] = []
    search_count = 0

    for item in data.get("output") or []:
        item_type = item.get("type")

        if item_type == "message":
            for content in item.get("content") or []:
                if content.get("type") == "output_text":
                    content_parts.append(content.get("text") or "")

        elif item_type == "reasoning":
            for content in item.get("content") or []:
                if content.get("type") == "reasoning_text":
                    reasoning_parts.append(content.get("text") or "")

        elif item_type == "web_search_call":
            item_queries, item_sources = parse_search_action(item.get("action"))
            _add_unique(queries, item_queries)
            _add_unique(sources, item_sources)
            search_count += 1

    search_meta = None
    if queries or sources or search_count:
        search_meta = {
            "queries": queries,
            "sources": sources,
            "count": search_count,
        }

    return "".join(content_parts), "\n\n".join(reasoning_parts), search_meta


class ResponsesStreamAdapter:
    """Feed it Responses events; it returns chat-completions shaped frames."""

    def __init__(self) -> None:
        self.full_content = ""
        self.full_reasoning = ""
        self.token_count: int | None = None
        self.model_name: str | None = None

        self.queries: list[str] = []
        self.sources: list[str] = []
        self.search_count = 0

        # Tracked by item id so parallel searches don't inflate the counter:
        # `output_item.added` and `web_search_call.in_progress` both fire for
        # the same search, and DeepSeek runs several at once.
        self._started: set[str] = set()
        self._completed: set[str] = set()

    # ── output ───────────────────────────────────────────────────────

    @property
    def search_in_progress(self) -> bool:
        return bool(self._started - self._completed)

    def search_frame(self) -> dict:
        """The full cumulative search state.

        Cumulative rather than incremental on purpose: the client assigns it
        wholesale, so a dropped or duplicated frame cannot desync the panel.
        """
        return {
            SEARCH_KEY: {
                "queries": list(self.queries),
                "sources": list(self.sources),
                "count": self.search_count,
                "in_progress": self.search_in_progress,
            }
        }

    def as_search_meta(self) -> dict | None:
        """What to persist on the Message, or None if nothing was searched."""
        if not (self.queries or self.sources or self.search_count):
            return None
        return {
            "queries": list(self.queries),
            "sources": list(self.sources),
            "count": self.search_count,
        }

    # ── input ────────────────────────────────────────────────────────

    def feed(self, event: dict) -> list[dict]:
        """Consume one Responses event, return 0..n normalized frames."""
        event_type = event.get("type")

        if event_type in ("response.created", "response.in_progress"):
            self._note_model(event)
            return []

        if event_type in _REASONING_DELTA_TYPES:
            delta = event.get("delta") or ""
            if not delta:
                return []
            self.full_reasoning += delta
            return [_reasoning_frame(delta)]

        if event_type == "response.output_text.delta":
            delta = event.get("delta") or ""
            if not delta:
                return []
            self.full_content += delta
            return [_text_frame(delta)]

        if event_type == "response.output_item.added":
            return self._on_item_added(event.get("item") or {})

        if event_type == "response.output_item.done":
            return self._on_item_done(event.get("item") or {})

        if event_type in (
            "response.web_search_call.in_progress",
            "response.web_search_call.searching",
        ):
            self._started.add(event.get("item_id") or "")
            return [self.search_frame()]

        if event_type == "response.web_search_call.completed":
            self._completed.add(event.get("item_id") or "")
            return [self.search_frame()]

        if event_type == "response.completed":
            return self._on_completed(event.get("response") or {})

        if event_type == "error":
            message = (
                (event.get("error") or {}).get("message")
                if isinstance(event.get("error"), dict)
                else None
            ) or event.get("message") or "Upstream returned an error event"
            return [{"error": message}]

        return []

    # ── event handlers ───────────────────────────────────────────────

    def _note_model(self, event: dict) -> None:
        model = event.get("model")
        if model and not self.model_name:
            self.model_name = model

    def _on_item_added(self, item: dict) -> list[dict]:
        item_type = item.get("type")

        if item_type == "reasoning":
            # A search turn produces MANY reasoning items interleaved with
            # web_search_call items.  Concatenating their deltas without a
            # separator runs the model's thoughts together mid-sentence.
            # Emitting the separator as a normal delta keeps what the browser
            # streams byte-identical to what gets persisted.
            if self.full_reasoning:
                self.full_reasoning += "\n\n"
                return [_reasoning_frame("\n\n")]
            return []

        if item_type == "web_search_call":
            self._started.add(item.get("id") or "")
            return [self.search_frame()]

        return []

    def _on_item_done(self, item: dict) -> list[dict]:
        if item.get("type") != "web_search_call":
            return []

        # Queries and opened pages only ever arrive here — the
        # web_search_call.* events carry no `action`.
        queries, sources = parse_search_action(item.get("action"))
        _add_unique(self.queries, queries)
        _add_unique(self.sources, sources)
        self.search_count += 1
        self._completed.add(item.get("id") or "")

        return [self.search_frame()]

    def _on_completed(self, response: dict) -> list[dict]:
        usage = response.get("usage") or {}
        total = usage.get("total_tokens")
        if total is not None:
            self.token_count = total

        # The envelope `model` on delta events is LiteLLM's alias (what the
        # user picked); `response.model` here is the upstream model name.
        # Prefer the alias to match what the chat-completions path records.
        if not self.model_name:
            self.model_name = response.get("model")

        frames: list[dict] = []

        # Safety net: if no text deltas arrived (some upstreams only send the
        # final item), recover the answer from the completed response.
        if not self.full_content:
            recovered = self._extract_text(response)
            if recovered:
                self.full_content = recovered
                frames.append(_text_frame(recovered))

        self._completed |= self._started
        if self._started:
            frames.append(self.search_frame())

        return frames

    @staticmethod
    def _extract_text(response: dict) -> str:
        parts: list[str] = []
        for item in response.get("output") or []:
            if item.get("type") != "message":
                continue
            for content in item.get("content") or []:
                if content.get("type") == "output_text":
                    parts.append(content.get("text") or "")
        return "".join(parts)
