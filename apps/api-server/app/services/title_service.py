"""AI-powered conversation title generation using the system-utility model.

This module is designed to run in a background asyncio task, completely
independent of the request lifecycle.  It opens its own DB session and
manages all error handling internally — failures are logged and fall
back to the existing truncated-title behavior.
"""

import logging

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.db.models.conversation import Conversation
from app.db.session import async_session_factory

logger = logging.getLogger(__name__)

SYSTEM_UTILITY_MODEL_NAME = "system-utility"


async def _call_system_utility_for_title(
    user_message: str,
    assistant_response: str,
) -> str | None:
    """Call LiteLLM's system-utility model to generate a conversation title.

    Returns the cleaned title string, or ``None`` on any failure (callers
    treat ``None`` as "keep the existing fallback title").
    """
    # Truncate inputs to avoid sending excessive context for a simple title task
    truncated_user = user_message[:500]
    truncated_assistant = assistant_response[:1000]

    prompt = (
        f'"{truncated_user}\n\n{truncated_assistant}"\n\n'
        "将以上对话内容总结为二十字以内的主题，只输出主题本身，不要引号、不要解释、不要前缀。"
    )

    payload = {
        "model": SYSTEM_UTILITY_MODEL_NAME,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "max_tokens": 1024,
        "temperature": 0.3,
    }

    url = f"{settings.LITELLM_BASE_URL}/v1/chat/completions"
    logger.info("TitleGen: calling %s with model=%s", url, SYSTEM_UTILITY_MODEL_NAME)
    logger.debug("TitleGen prompt:\n%s", prompt)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                    "Content-Type": "application/json",
                },
            )

            logger.debug("TitleGen: LiteLLM responded status=%s", resp.status_code)

            if resp.status_code != 200:
                logger.warning(
                    "TitleGen FAILED: LiteLLM returned %s — %s",
                    resp.status_code,
                    resp.text[:500],
                )
                return None

            data = resp.json()
            logger.debug("TitleGen: response body =\n%s", resp.text)

            raw = data["choices"][0]["message"]["content"].strip()
            logger.info("TitleGen: raw model output = %r", raw)

            # Strip wrapping quotes that models often add
            title = raw.strip("\"'").strip()

            if not title:
                logger.warning(
                    "TitleGen FAILED: empty string after stripping (raw was %r)",
                    raw,
                )
                return None

            # Safety cap — the prompt asks for ≤20, but guard against misbehavior
            if len(title) > 50:
                logger.debug("TitleGen: truncating from %d to 50 chars", len(title))
                title = title[:50]

            logger.info("TitleGen SUCCESS: %r", title)
            return title

    except httpx.TimeoutException:
        logger.warning("TitleGen FAILED: timed out after 15s calling %s", url)
        return None
    except httpx.ConnectError as e:
        logger.warning("TitleGen FAILED: cannot connect to LiteLLM at %s — %s", url, e)
        return None
    except Exception:
        logger.exception("TitleGen FAILED: unexpected exception")
        return None


async def regenerate_conversation_title(
    conversation_id,
    user_message: str,
    assistant_response: str,
) -> None:
    """Background task: generate an AI-powered title for a new conversation.

    Designed to run in an ``asyncio.create_task`` fire-and-forget context
    after the streaming response completes.  This function:

    1. Calls the system-utility model for a concise title
    2. Opens a fresh DB session and updates the conversation title

    Falls back silently on failure — the truncated title from the main
    request handler remains as-is.
    """
    logger.info(
        "TitleGen: background task STARTED for conversation %s "
        "(user_msg len=%d, assistant_msg len=%d)",
        conversation_id, len(user_message), len(assistant_response),
    )

    title = await _call_system_utility_for_title(user_message, assistant_response)
    if not title:
        logger.warning(
            "TitleGen: no title returned, keeping fallback for conversation %s",
            conversation_id,
        )
        return

    async with async_session_factory() as session:
        try:
            result = await session.execute(
                select(Conversation).where(Conversation.id == conversation_id)
            )
            conversation = result.scalar_one_or_none()
            if conversation is None:
                logger.warning(
                    "TitleGen: conversation %s not found in DB (deleted?)",
                    conversation_id,
                )
                return

            old_title = conversation.title
            conversation.title = title
            await session.commit()
            logger.info(
                "TitleGen: updated conversation %s title %r → %r",
                conversation_id, old_title, title,
            )
        except Exception:
            await session.rollback()
            logger.exception(
                "TitleGen: DB update failed for conversation %s",
                conversation_id,
            )
