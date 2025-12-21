"""User preference extraction and storage."""

from __future__ import annotations

from llama_stack_client import LlamaStackClient

from myloware.memory.banks import insert_memory
from myloware.observability.logging import get_logger

logger = get_logger("memory.preferences")

__all__ = ["extract_and_store_preference"]

PREFERENCE_INDICATORS = [
    "i prefer",
    "i like",
    "i want",
    "always use",
    "never use",
    "my favorite",
    "i usually",
]


def extract_and_store_preference(
    client: LlamaStackClient,
    user_id: str,
    message: str,
) -> bool:
    """Extract and store user preference from a message."""

    message_lower = message.lower()
    has_preference = any(indicator in message_lower for indicator in PREFERENCE_INDICATORS)

    if not has_preference:
        return False

    insert_memory(
        client,
        user_id=user_id,
        content=message,
        metadata={"type": "preference"},
    )

    logger.info("Stored preference for user %s", user_id)
    return True
