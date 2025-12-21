"""Knowledge document loader for Vector I/O ingestion.

Supports:
- Nested directory structures (e.g., video-generation/veo3-prompting-guide.md)
- Enhanced metadata extraction (category, section, document path)
- Both global and project-specific knowledge bases
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, List, Tuple

from myloware.paths import get_repo_root

ROOT = get_repo_root()
MANIFEST_PATH = ROOT / "data" / ".kb_manifest.json"


@dataclass
class KnowledgeDocument:
    """A knowledge document ready for ingestion.

    Attributes:
        id: Unique identifier for the document
        content: Full text content of the document
        filename: Original filename (e.g., "veo3-prompting-guide.md")
        metadata: Additional metadata for retrieval context
    """

    id: str
    content: str
    filename: str
    metadata: dict[str, Any] = field(default_factory=dict)


def get_knowledge_dir() -> Path:
    """Get global knowledge data directory."""
    return ROOT / "data" / "knowledge"


def get_project_knowledge_dir(project_id: str) -> Path:
    """Get project-specific knowledge directory."""
    return ROOT / "data" / "projects" / project_id / "knowledge"


def extract_first_heading(content: str) -> str:
    """Extract the first markdown heading from content.

    Returns the heading text without the # prefix, or "Overview" if none found.
    """
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("#"):
            # Remove all leading # and whitespace
            return re.sub(r"^#+\s*", "", line)
    return "Overview"


def extract_all_headings(content: str) -> list[str]:
    """Extract all markdown headings from content.

    Useful for understanding document structure.
    """
    headings = []
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("#"):
            headings.append(re.sub(r"^#+\s*", "", line))
    return headings


def load_manifest() -> dict[str, Any] | None:
    """Load the last saved knowledge-base manifest, if present."""
    if not MANIFEST_PATH.exists():
        return None
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_manifest(manifest: dict[str, Any]) -> None:
    """Persist the current knowledge-base manifest for change detection."""
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")


def _compute_manifest(files: list[Path]) -> dict[str, Any]:
    """Compute a deterministic manifest hash from file paths + stat metadata."""
    h = hashlib.sha256()
    entries: list[dict[str, Any]] = []
    for path in sorted(files):
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        stat = path.stat()
        entry = {"path": rel, "mtime_ns": stat.st_mtime_ns, "size": stat.st_size}
        entries.append(entry)
        h.update(rel.encode("utf-8"))
        h.update(str(stat.st_mtime_ns).encode("utf-8"))
        h.update(str(stat.st_size).encode("utf-8"))
    return {"hash": h.hexdigest(), "files": entries}


def _load_documents_from_dir(
    knowledge_dir: Path,
    kb_type: str = "global",
    read_content: bool = True,
) -> Tuple[List[KnowledgeDocument], list[Path]]:
    """Load all markdown documents from a directory (recursively).

    Args:
        knowledge_dir: Directory to scan for .md files
        kb_type: Type of knowledge base ("global" or "project:{project_id}")
        read_content: Whether to read file contents into KnowledgeDocument.content

    Returns:
        (documents, files_used)
    """
    if not knowledge_dir.exists():
        return [], []

    docs: List[KnowledgeDocument] = []
    files: list[Path] = []

    # Use rglob for recursive directory scanning
    for doc_path in knowledge_dir.rglob("*.md"):
        # Skip index and readme files
        if doc_path.name.lower() in ("index.md", "readme.md"):
            continue

        files.append(doc_path)
        content = doc_path.read_text(encoding="utf-8") if read_content else ""

        # Calculate relative path from knowledge dir
        relative_path = doc_path.relative_to(knowledge_dir)

        # Extract category from directory path
        if relative_path.parent != Path("."):
            category = str(relative_path.parent).replace("\\", "/")
        else:
            category = "general"

        # Create unique ID based on path
        doc_id = f"kb_{category}_{doc_path.stem}".replace("/", "_").replace("-", "_")

        # Extract first heading for section context
        first_heading = extract_first_heading(content)

        docs.append(
            KnowledgeDocument(
                id=doc_id,
                content=content,
                filename=doc_path.name,
                metadata={
                    "source": "knowledge_base",
                    "kb_type": kb_type,
                    "filename": doc_path.name,
                    "document": str(relative_path),
                    "category": category,
                    "section": first_heading if read_content else "Overview",
                },
            )
        )

    return docs, files


def load_documents_with_manifest(
    project_id: str | None,
    include_global: bool = True,
    read_content: bool = True,
) -> tuple[list[KnowledgeDocument], dict[str, Any]]:
    """Load knowledge documents and return a manifest for change detection."""
    all_docs: list[KnowledgeDocument] = []
    files: list[Path] = []

    if include_global:
        docs, used = _load_documents_from_dir(
            get_knowledge_dir(), kb_type="global", read_content=read_content
        )
        all_docs.extend(docs)
        files.extend(used)

    if project_id:
        docs, used = _load_documents_from_dir(
            get_project_knowledge_dir(project_id),
            kb_type=f"project:{project_id}",
            read_content=read_content,
        )
        all_docs.extend(docs)
        files.extend(used)

    manifest = _compute_manifest(files)
    return all_docs, manifest


def load_knowledge_documents(
    include_global: bool = True,
    project_id: str | None = None,
) -> Iterator[KnowledgeDocument]:
    """Load knowledge documents for Vector I/O ingestion.

    Args:
        include_global: Whether to include global knowledge base documents
        project_id: Optional project ID to include project-specific documents

    Returns:
        Iterator of KnowledgeDocument objects

    Example:
        # Load only global KB
        docs = list(load_knowledge_documents())

        # Load global + project KB
        docs = list(load_knowledge_documents(project_id="aismr"))

        # Load only project KB
        docs = list(load_knowledge_documents(include_global=False, project_id="aismr"))
    """
    all_docs: List[KnowledgeDocument] = []

    # Load global knowledge base
    if include_global:
        global_docs, _ = _load_documents_from_dir(
            get_knowledge_dir(),
            kb_type="global",
            read_content=True,
        )
        all_docs.extend(global_docs)

    # Load project-specific knowledge base
    if project_id:
        project_docs, _ = _load_documents_from_dir(
            get_project_knowledge_dir(project_id),
            kb_type=f"project:{project_id}",
            read_content=True,
        )
        all_docs.extend(project_docs)

    return iter(all_docs)


def list_knowledge_documents(
    include_global: bool = True,
    project_id: str | None = None,
) -> list[str]:
    """List available knowledge document paths.

    Returns relative paths like "video-generation/veo3-prompting-guide".
    """
    docs = list(
        load_knowledge_documents(
            include_global=include_global,
            project_id=project_id,
        )
    )
    return [doc.metadata.get("document", doc.filename).replace(".md", "") for doc in docs]


def get_knowledge_stats() -> dict:
    """Get statistics about the knowledge base.

    Useful for debugging and validation.
    """
    global_docs = list(load_knowledge_documents(include_global=True, project_id=None))

    categories = {}
    for doc in global_docs:
        cat = doc.metadata.get("category", "general")
        categories[cat] = categories.get(cat, 0) + 1

    return {
        "total_documents": len(global_docs),
        "categories": categories,
        "documents": [doc.metadata.get("document", doc.filename) for doc in global_docs],
    }


__all__ = [
    "KnowledgeDocument",
    "get_knowledge_dir",
    "get_project_knowledge_dir",
    "load_knowledge_documents",
    "load_documents_with_manifest",
    "load_manifest",
    "save_manifest",
    "list_knowledge_documents",
    "extract_first_heading",
    "get_knowledge_stats",
]
