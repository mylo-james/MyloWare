"""Llama Stack backend adapter.

This keeps direct SDK usage in one place so app logic can depend on small,
testable Protocols instead of vendor types.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from myloware.backends.protocols import SafetyCheckResult, VectorSearchHit
from myloware.config import settings
from myloware.llama_clients import get_async_client, get_sync_client


@dataclass(frozen=True)
class LlamaStackBackend:
    """Default backend implementation using Llama Stack."""

    sync_client: object | None = None
    async_client: object | None = None

    def _sync(self) -> object:
        return self.sync_client or get_sync_client()

    def _async(self) -> object:
        return self.async_client or get_async_client()

    def chat_text(self, *, messages: list[dict[str, Any]], model_id: str | None = None) -> str:
        client = self._sync()
        model = model_id or settings.llama_stack_model
        response = client.chat.completions.create(  # type: ignore[attr-defined]
            model=model,
            messages=messages,
            stream=False,
        )
        return _extract_content(response)

    def chat_json(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> dict[str, Any]:
        client = self._sync()
        model = model_id or settings.llama_stack_model
        response = client.chat.completions.create(  # type: ignore[attr-defined]
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
            stream=False,
        )
        choices = getattr(response, "choices", None)
        if choices is not None and not choices:
            raise RuntimeError("LLM returned no choices")
        content = _extract_content(response)
        if not content:
            raise RuntimeError("LLM returned empty content")
        data = json.loads(content)
        if not isinstance(data, dict):
            raise RuntimeError("LLM returned non-object JSON")
        return data

    async def chat_text_async(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> str:
        client = self._async()
        model = model_id or settings.llama_stack_model
        response = await client.chat.completions.create(  # type: ignore[attr-defined]
            model=model,
            messages=messages,
            stream=False,
        )
        return _extract_content(response)

    async def chat_json_async(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> dict[str, Any]:
        client = self._async()
        model = model_id or settings.llama_stack_model
        response = await client.chat.completions.create(  # type: ignore[attr-defined]
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
            stream=False,
        )
        choices = getattr(response, "choices", None)
        if choices is not None and not choices:
            raise RuntimeError("LLM returned no choices")
        content = _extract_content(response)
        if not content:
            raise RuntimeError("LLM returned empty content")
        data = json.loads(content)
        if not isinstance(data, dict):
            raise RuntimeError("LLM returned non-object JSON")
        return data

    async def check_content_safety(self, content: str) -> SafetyCheckResult:
        from myloware.safety.shields import check_content_safety as _check

        result = await _check(self._async(), content, shield_id=settings.content_safety_shield_id)
        return SafetyCheckResult(
            safe=bool(getattr(result, "safe", False)),
            reason=getattr(result, "reason", None),
            category=getattr(result, "category", None),
            severity=getattr(result, "severity", None),
        )

    def search_vector_store(
        self,
        *,
        vector_store_id: str,
        query: str,
        max_results: int = 10,
        search_mode: str = "vector",
        ranking_options: dict[str, Any] | None = None,
    ) -> list[VectorSearchHit]:
        client = self._sync()
        search_kwargs: dict[str, Any] = {
            "vector_store_id": vector_store_id,
            "query": query,
            "max_num_results": max_results,
        }
        if search_mode != "vector":
            search_kwargs["search_mode"] = search_mode
        if ranking_options and search_mode == "hybrid":
            search_kwargs["ranking_options"] = ranking_options

        response = client.vector_stores.search(**search_kwargs)  # type: ignore[attr-defined]
        raw_results = list(getattr(response, "data", None) or [])

        hits: list[VectorSearchHit] = []
        for result in raw_results:
            filename = getattr(result, "filename", None)
            score = getattr(result, "score", None)
            content = getattr(result, "content", None) or getattr(result, "text", None)
            metadata = getattr(result, "metadata", None) or {}
            hits.append(
                VectorSearchHit(
                    filename=str(filename) if filename is not None else None,
                    score=float(score) if score is not None else None,
                    content=str(content) if content is not None else None,
                    metadata=dict(metadata) if isinstance(metadata, dict) else {},
                )
            )

        return hits


def _extract_content(response: object) -> str:
    choices = getattr(response, "choices", None)
    if choices:
        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", None) if message else None
        if content:
            return str(content)
    content = getattr(response, "content", None)
    return str(content) if content else ""
