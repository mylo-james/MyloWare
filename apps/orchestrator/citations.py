"""Helpers for building and attaching citation metadata to state/artifacts."""
from __future__ import annotations

from typing import Iterable, List, MutableMapping, TypedDict


class Citation(TypedDict):
    doc_id: str
    path: str
    reason: str


def build_citations(results: Iterable[tuple[str, str, float, str]], reason: str) -> List[Citation]:
    citations: List[Citation] = []
    for doc_id, path, *_ in results:
        citations.append({"doc_id": doc_id, "path": path, "reason": reason})
    return citations


def append_citations(state: MutableMapping[str, object], citations: Iterable[Citation]) -> None:
    """Append citations to the mutable state dict."""
    new_citations = list(citations)
    if not new_citations:
        return
    existing = state.get("citations")
    if not isinstance(existing, list):
        state["citations"] = list(new_citations)
        return
    existing.extend(new_citations)
