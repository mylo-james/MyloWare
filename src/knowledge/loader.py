"""Knowledge document loader for Vector I/O ingestion."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List

ROOT = Path(__file__).resolve().parent.parent.parent


@dataclass
class KnowledgeDocument:
    """A knowledge document ready for ingestion."""

    id: str
    content: str
    filename: str
    metadata: dict


def get_knowledge_dir() -> Path:
    """Get knowledge data directory."""

    return ROOT / "data" / "knowledge"


def load_knowledge_documents() -> Iterator[KnowledgeDocument]:
    """Load all knowledge documents for Vector I/O ingestion."""

    knowledge_dir = get_knowledge_dir()
    if not knowledge_dir.exists():
        return iter(())

    docs: List[KnowledgeDocument] = []
    for doc_path in knowledge_dir.glob("*.md"):
        if doc_path.name == "index.md":
            continue
        content = doc_path.read_text(encoding="utf-8")
        docs.append(
            KnowledgeDocument(
                id=f"kb_{doc_path.stem}",
                content=content,
                filename=doc_path.name,
                metadata={
                    "source": "knowledge_base",
                    "filename": doc_path.name,
                },
            )
        )
    return iter(docs)


def list_knowledge_documents() -> list[str]:
    """List available knowledge document names (without extension)."""

    knowledge_dir = get_knowledge_dir()
    if not knowledge_dir.exists():
        return []
    return [p.stem for p in knowledge_dir.glob("*.md") if p.name != "index.md"]


__all__ = [
    "KnowledgeDocument",
    "get_knowledge_dir",
    "load_knowledge_documents",
    "list_knowledge_documents",
]
