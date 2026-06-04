"""Key service — business logic for API key management."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.api_key import ApiKey


async def get_key_spend_from_litellm(
    litellm_key_id: str,
) -> float:
    """Query LiteLLM for the spend associated with a key. Returns 0.0 on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.LITELLM_BASE_URL}/global/spend/logs",
                params={"api_key": litellm_key_id},
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return float(data.get("total_spend", 0.0))
    except Exception:
        pass
    return 0.0
