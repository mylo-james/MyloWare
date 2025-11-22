"""Knowledge base helpers (pgvector retrieval & ingestion)."""
from .retrieval import ingest_kb, search_kb, search_by_category

__all__ = ["ingest_kb", "search_kb", "search_by_category"]
