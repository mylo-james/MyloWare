"""Thin adapter for OpenAI embedding endpoints."""
from __future__ import annotations

import os
from typing import Iterable, Sequence

from openai import OpenAI


class OpenAIEmbeddingClient:
    def __init__(self, *, api_key: str, default_model: str = "text-embedding-3-small") -> None:
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required for embeddings")
        self._client = OpenAI(api_key=api_key)
        self._default_model = default_model

    def embed(self, texts: Sequence[str], *, model: str | None = None) -> list[list[float]]:
        if not texts:
            return []
        response = self._client.embeddings.create(model=model or self._default_model, input=list(texts))
        return [record.embedding for record in response.data]


def build_openai_embedding_client(
    *, api_key: str | None = None, default_model: str = "text-embedding-3-small"
) -> OpenAIEmbeddingClient:
    api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY must be set to create an embedding client")
    return OpenAIEmbeddingClient(api_key=api_key, default_model=default_model)


__all__ = ["OpenAIEmbeddingClient", "build_openai_embedding_client"]
