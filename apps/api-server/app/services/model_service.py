"""Model service — shared LiteLLM model listing for non-admin consumers."""

import asyncio
import logging
import time

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Platform-internal model used for titles/summaries. Never user-facing:
# excluded from every list, chat picker and API key dialog alike.
SYSTEM_UTILITY_MODEL_NAME = "system-utility"

# ── Transport ────────────────────────────────────────────────────────

# Must match the provider key in admin.py's PROVIDER_PREFIX — that is where an
# admin opts a model into the Responses API by picking this provider.
RESPONSES_PROVIDER = "deepseek_responses"

TRANSPORT_CHAT = "chat"
TRANSPORT_RESPONSES = "responses"

# Provider → the LiteLLM endpoint models of that provider must be called on.
# Anything absent resolves to TRANSPORT_CHAT, so models created before the
# Responses transport existed keep their exact current behaviour.
_PROVIDER_TRANSPORT: dict[str, str] = {
    RESPONSES_PROVIDER: TRANSPORT_RESPONSES,
}

# /model/info returns a fat payload (each entry embeds the full cost map) and
# now sits on the per-message hot path via resolve_transport(), so cache it.
# Per-process only — with multiple api-server replicas an admin's change can
# take up to _MODEL_CACHE_TTL to propagate; admin.py invalidates its own.
_MODEL_CACHE_TTL = 60.0
_model_cache: list[dict] | None = None
_model_cache_at: float = 0.0
_model_cache_lock = asyncio.Lock()


async def _raw_model_entries() -> list[dict] | None:
    """Fetch (and cache) the raw ``/model/info`` entries.

    Returns ``None`` when LiteLLM is unreachable or answers non-200, leaving
    each caller to pick between an empty list and a 502.
    """
    global _model_cache, _model_cache_at

    async with _model_cache_lock:
        now = time.monotonic()
        if _model_cache is not None and now - _model_cache_at < _MODEL_CACHE_TTL:
            return _model_cache

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{settings.LITELLM_BASE_URL}/model/info",
                    headers={"Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}"},
                )
        except httpx.HTTPError as exc:
            logger.warning("LiteLLM /model/info unreachable: %s", exc)
            return None

        if resp.status_code != 200:
            logger.warning(
                "LiteLLM /model/info returned %s: %s", resp.status_code, resp.text[:200]
            )
            return None

        _model_cache = resp.json().get("data", []) or []
        _model_cache_at = now
        return _model_cache


def invalidate_model_cache() -> None:
    """Drop the cache so an admin's change is visible on the next read."""
    global _model_cache, _model_cache_at
    _model_cache = None
    _model_cache_at = 0.0


def _normalize(entry: dict) -> dict:
    """Normalize a LiteLLM /model/info entry into the web client shape."""
    model_name = entry.get("model_name", "unknown")
    model_info = entry.get("model_info", {}) or {}
    provider = model_info.get("admin_provider") or model_info.get("litellm_provider", "")

    return {
        "id": model_info.get("id", model_name),
        "name": model_name,
        "provider": provider,
        "description": model_info.get("description", ""),
        "transport": _PROVIDER_TRANSPORT.get(provider, TRANSPORT_CHAT),
    }


async def list_models(*, include_hidden_from_chat: bool = False) -> list[dict] | None:
    """List models from the LiteLLM proxy, normalized for the web client.

    ``hidden_from_chat`` only controls the chat model picker. Callers that
    need the full set — notably API key generation, where the hidden models
    are precisely the API-only ones — pass ``include_hidden_from_chat=True``.

    Returns ``None`` when LiteLLM is unreachable or returns a non-200, so
    each caller can choose between an empty list and a 502.
    """
    entries = await _raw_model_entries()
    if entries is None:
        return None

    models = []
    for entry in entries:
        model_name = entry.get("model_name", "unknown")
        if model_name == SYSTEM_UTILITY_MODEL_NAME:
            continue
        model_info = entry.get("model_info", {}) or {}
        if model_info.get("hidden_from_chat") and not include_hidden_from_chat:
            continue
        models.append(_normalize(entry))

    return models


async def resolve_transport(model_name: str) -> str:
    """Which LiteLLM endpoint ``model_name`` must be called on.

    Falls back to chat completions whenever the model can't be resolved — an
    unknown model then behaves exactly as it did before the Responses
    transport existed, rather than silently taking a new code path.
    """
    entries = await _raw_model_entries()
    if entries is None:
        return TRANSPORT_CHAT

    for entry in entries:
        if entry.get("model_name") == model_name:
            return _normalize(entry)["transport"]

    logger.warning(
        "Model %r not found in LiteLLM /model/info — assuming chat completions", model_name
    )
    return TRANSPORT_CHAT
