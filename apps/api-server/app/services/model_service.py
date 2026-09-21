"""Model service — shared LiteLLM model listing for non-admin consumers."""

import httpx

from app.core.config import settings

# Platform-internal model used for titles/summaries. Never user-facing:
# excluded from every list, chat picker and API key dialog alike.
SYSTEM_UTILITY_MODEL_NAME = "system-utility"


def _normalize(entry: dict) -> dict:
    """Normalize a LiteLLM /model/info entry into the web client shape."""
    model_name = entry.get("model_name", "unknown")
    model_info = entry.get("model_info", {}) or {}

    return {
        "id": model_info.get("id", model_name),
        "name": model_name,
        "provider": model_info.get("admin_provider") or model_info.get("litellm_provider", ""),
        "description": model_info.get("description", ""),
    }


async def list_models(*, include_hidden_from_chat: bool = False) -> list[dict] | None:
    """List models from the LiteLLM proxy, normalized for the web client.

    ``hidden_from_chat`` only controls the chat model picker. Callers that
    need the full set — notably API key generation, where the hidden models
    are precisely the API-only ones — pass ``include_hidden_from_chat=True``.

    Returns ``None`` when LiteLLM is unreachable or returns a non-200, so
    each caller can choose between an empty list and a 502.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.LITELLM_BASE_URL}/model/info",
                headers={"Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}"},
            )
    except httpx.HTTPError:
        return None

    if resp.status_code != 200:
        return None

    models = []
    for entry in resp.json().get("data", []) or []:
        model_name = entry.get("model_name", "unknown")
        if model_name == SYSTEM_UTILITY_MODEL_NAME:
            continue
        model_info = entry.get("model_info", {}) or {}
        if model_info.get("hidden_from_chat") and not include_hidden_from_chat:
            continue
        models.append(_normalize(entry))

    return models
