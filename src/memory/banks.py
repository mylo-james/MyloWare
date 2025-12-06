"""Llama Stack memory bank management."""

from __future__ import annotations

import logging
from typing import Any

from llama_stack_client import LlamaStackClient

logger = logging.getLogger("memory.banks")

__all__ = [
    "register_memory_bank",
    "insert_memory",
    "query_memory",
    "clear_user_memory",
    "USER_PREFERENCES_BANK",
]

# Memory bank ID for user preferences
USER_PREFERENCES_BANK = "user-preferences"


def register_memory_bank(
    client: LlamaStackClient,
    memory_bank_id: str = USER_PREFERENCES_BANK,
    embedding_model: str = "all-MiniLM-L6-v2",  # Must match llama_stack/run.yaml
) -> None:
    """Register a memory bank with Llama Stack."""

    logger.info("Registering memory bank: %s", memory_bank_id)

    client.memory_banks.register(
        memory_bank_id=memory_bank_id,
        params={
            "embedding_model": embedding_model,
            "chunk_size_in_tokens": 256,
        },
    )

    logger.info("Memory bank registered: %s", memory_bank_id)


def insert_memory(
    client: LlamaStackClient,
    user_id: str,
    content: str,
    memory_bank_id: str = USER_PREFERENCES_BANK,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert a memory for a user."""

    logger.info("Inserting memory for user: %s", user_id)

    doc_metadata = {"user_id": user_id, **(metadata or {})}

    client.memory.insert(
        memory_bank_id=memory_bank_id,
        documents=[
            {
                "document_id": f"{user_id}:{abs(hash(content))}",
                "content": content,
                "metadata": doc_metadata,
            }
        ],
    )

    logger.info("Memory inserted for user: %s", user_id)


def query_memory(
    client: LlamaStackClient,
    user_id: str,
    query: str,
    memory_bank_id: str = USER_PREFERENCES_BANK,
    max_results: int = 5,
) -> list[dict[str, Any]]:
    """Query memories for a user."""

    logger.info("Querying memory for user: %s", user_id)

    response = client.memory.query(
        memory_bank_id=memory_bank_id,
        query=query,
        params={"max_chunks": max_results, "filter": {"user_id": user_id}},
    )

    return getattr(response, "chunks", [])


def clear_user_memory(
    client: LlamaStackClient,
    user_id: str,
    memory_bank_id: str = USER_PREFERENCES_BANK,
) -> None:
    """Clear all memories for a user."""

    logger.info("Clearing memory for user: %s", user_id)

    memories = query_memory(
        client, user_id, query="*", memory_bank_id=memory_bank_id, max_results=1000
    )

    doc_ids = [m.get("document_id") for m in memories if m.get("document_id")]
    if not doc_ids:
        return

    client.memory.delete(memory_bank_id=memory_bank_id, document_ids=doc_ids)

    logger.info("Memory cleared for user: %s", user_id)
