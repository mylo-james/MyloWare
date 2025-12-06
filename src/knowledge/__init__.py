"""MyloWare knowledge module - Vector I/O and RAG setup."""

from knowledge.setup import (
    register_knowledge_base,
    ingest_documents,
    setup_project_knowledge,
    DEFAULT_CHUNK_SIZE,
)
from knowledge.loader import (
    load_knowledge_documents,
    list_knowledge_documents,
    KnowledgeDocument,
    get_knowledge_dir,
)

__all__ = [
    "register_knowledge_base",
    "ingest_documents",
    "setup_project_knowledge",
    "DEFAULT_CHUNK_SIZE",
    "load_knowledge_documents",
    "list_knowledge_documents",
    "KnowledgeDocument",
    "get_knowledge_dir",
]
