"""Protocol interfaces for external AI/service dependencies.

These are intentionally small: the goal is to keep app logic testable and
portable without introducing a large abstraction layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class SafetyCheckResult:
    safe: bool
    reason: str | None = None
    category: str | None = None
    severity: str | None = None


@dataclass(frozen=True)
class VectorSearchHit:
    filename: str | None
    score: float | None
    content: str | None
    metadata: dict[str, Any]


class SyncChatBackend(Protocol):
    def chat_text(self, *, messages: list[dict[str, Any]], model_id: str | None = None) -> str: ...

    def chat_json(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> dict[str, Any]: ...


class AsyncChatBackend(Protocol):
    async def chat_text_async(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> str: ...

    async def chat_json_async(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> dict[str, Any]: ...


class SafetyBackend(Protocol):
    async def check_content_safety(self, content: str) -> SafetyCheckResult: ...


class VectorSearchBackend(Protocol):
    def search_vector_store(
        self,
        *,
        vector_store_id: str,
        query: str,
        max_results: int = 10,
        search_mode: str = "vector",
        ranking_options: dict[str, Any] | None = None,
    ) -> list[VectorSearchHit]: ...
