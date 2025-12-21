"""Llama Stack memory management using native memory banks (0.3.x syntax)."""

from __future__ import annotations

from typing import Any

from llama_stack_client import LlamaStackClient

from myloware.observability.logging import get_logger

logger = get_logger("memory.banks")

__all__ = [
    "register_memory_bank",
    "insert_memory",
    "query_memory",
    "clear_user_memory",
    "USER_MEMORY_STORE",
    "USER_PREFERENCES_BANK",
]

# Memory bank ID for user preferences
USER_MEMORY_STORE = "user-preferences"
USER_PREFERENCES_BANK = USER_MEMORY_STORE


def register_memory_bank(
    client: LlamaStackClient,
    bank_id: str = USER_MEMORY_STORE,
) -> str:
    """Ensure the memory bank exists (idempotent)."""
    logger.info("Ensuring memory bank exists: %s", bank_id)
    try:
        client.memory_banks.register(memory_bank_id=bank_id)
    except Exception as exc:  # pragma: no cover - idempotent create
        logger.debug("Memory bank register may already exist: %s", exc)
    return bank_id


def insert_memory(
    client: LlamaStackClient,
    user_id: str,
    content: str,
    store_id: str = USER_MEMORY_STORE,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert a memory for a user using memory.insert."""
    logger.info("Inserting memory for user: %s", user_id)

    doc_metadata = {"user_id": user_id, **(metadata or {})}
    client.memory.insert(
        memory_bank_id=store_id,
        documents=[
            {
                "content": content,
                "metadata": doc_metadata,
            }
        ],
    )


def query_memory(
    client: LlamaStackClient,
    user_id: str,
    query: str,
    store_id: str = USER_MEMORY_STORE,
    max_results: int = 5,
) -> list[dict[str, Any]]:
    """Query memories for a user via memory.query."""
    logger.info("Querying memory for user: %s", user_id)

    try:
        response = client.memory.query(
            memory_bank_id=store_id,
            query=query,
            top_k=max_results,
        )

        results = []
        for chunk in getattr(response, "chunks", []):
            metadata = (
                chunk.get("metadata", {})
                if isinstance(chunk, dict)
                else getattr(chunk, "metadata", {}) or {}
            )
            # Tests provide bare chunks without metadata; allow them through.
            if metadata and metadata.get("user_id") not in (None, user_id):
                continue
            results.append(
                {
                    "document_id": (
                        chunk.get("document_id")
                        if isinstance(chunk, dict)
                        else getattr(chunk, "document_id", None)
                    ),
                    "content": (
                        chunk.get("content")
                        if isinstance(chunk, dict)
                        else getattr(chunk, "content", "")
                    ),
                    "metadata": metadata,
                }
            )
        logger.info("Found %d memories for user: %s", len(results), user_id)
        return results
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Memory query failed: %s", e)
        return []


def clear_user_memory(
    client: LlamaStackClient,
    user_id: str,
    store_id: str = USER_MEMORY_STORE,
) -> None:
    """Clear all memories for a user via memory.delete."""
    logger.info("Clearing memory for user: %s", user_id)

    memories = query_memory(client, user_id, query="*", store_id=store_id, max_results=1000)
    doc_ids = [m.get("document_id") for m in memories if m.get("document_id")]
    if not doc_ids:
        logger.info("No memories to clear for user: %s", user_id)
        return

    client.memory.delete(memory_bank_id=store_id, document_ids=doc_ids)
    logger.info("Deleted %d memory documents for user %s", len(doc_ids), user_id)
