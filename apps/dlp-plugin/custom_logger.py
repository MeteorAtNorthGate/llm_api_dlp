"""LiteLLM Custom Logger — DLP hooks for pre/post API call masking."""

import json
from typing import Any

from masking_rules import apply_masking, restore_masking


class DLPCustomLogger:
    """Custom logger for LiteLLM that provides DLP data masking hooks.

    This is mounted as a LiteLLM callback. LiteLLM will call:
      - async_pre_api_call() before forwarding the request to the LLM
      - async_post_api_call() after receiving the response from the LLM
      - async_log_success_event() / async_log_failure_event() for logging

    The masking strategy:
      - pre_call: Replace sensitive data with same-length placeholders (████...)
      - post_call: Restore original values from the placeholder mapping
      - Same-length placeholders ensure token count is not affected by masking
    """

    def __init__(self):
        self._mapping_store: dict[str, dict[str, str]] = {}
        self._request_counter = 0

    async def async_pre_api_call(
        self, model: str, messages: list[dict], api_base: str,
        litellm_call_id: str, **kwargs: Any
    ) -> dict:
        """Called BEFORE the request is sent to the LLM.

        Masks all sensitive data in messages with same-length placeholders.
        """
        mapping: dict[str, str] = {}
        total_masked = 0

        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str) and content:
                masked_content, msg_mapping = apply_masking(content)
                msg["content"] = masked_content
                mapping.update(msg_mapping)
                total_masked += len(msg_mapping)

        # Store mapping for post-call restoration
        self._request_counter += 1
        store_key = f"{litellm_call_id}_{self._request_counter}"
        self._mapping_store[store_key] = mapping

        # Clean up old mappings (keep last 1000)
        if len(self._mapping_store) > 1000:
            oldest_keys = sorted(self._mapping_store.keys())[
                : len(self._mapping_store) - 1000
            ]
            for k in oldest_keys:
                del self._mapping_store[k]

        return {
            "masked_count": total_masked,
            "mapping_key": store_key,
        }

    async def async_post_api_call(
        self, model: str, messages: list[dict], api_base: str,
        litellm_call_id: str, response: Any, **kwargs: Any
    ) -> dict:
        """Called AFTER the response is received from the LLM.

        Restores original sensitive values in the response.
        """
        store_key = f"{litellm_call_id}_{self._request_counter}"

        # Restore original values in the response
        if hasattr(response, "choices"):
            for choice in response.choices:
                if hasattr(choice, "message") and hasattr(choice.message, "content"):
                    content = choice.message.content
                    if isinstance(content, str) and content:
                        choice.message.content = restore_masking(
                            content, self._mapping_store.get(store_key, {})
                        )

                # Handle streaming delta
                if hasattr(choice, "delta") and hasattr(choice.delta, "content"):
                    content = choice.delta.content
                    if isinstance(content, str) and content:
                        choice.delta.content = restore_masking(
                            content, self._mapping_store.get(store_key, {})
                        )

        return {"restored": True}

    async def async_log_success_event(
        self, kwargs: Any, response_obj: Any, start_time: float, end_time: float
    ) -> None:
        """Log successful LLM calls."""
        pass

    async def async_log_failure_event(
        self, kwargs: Any, response_obj: Any, start_time: float, end_time: float
    ) -> None:
        """Log failed LLM calls."""
        pass


# LiteLLM expects a module-level instance named 'custom_logger'
custom_logger = DLPCustomLogger()
