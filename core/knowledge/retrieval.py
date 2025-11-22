"""Simple pgvector-backed retrieval for data/kb ingestion and query."""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Iterable, List, Tuple
from uuid import uuid4

import psycopg
from prometheus_client import Histogram

try:
    from adapters.ai_providers.embeddings.openai_client import build_openai_embedding_client
    EMBEDDINGS_AVAILABLE = True
except Exception:
    build_openai_embedding_client = None  # type: ignore[assignment]
    EMBEDDINGS_AVAILABLE = False

try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    CHUNKING_AVAILABLE = True
except Exception:
    RecursiveCharacterTextSplitter = None  # type: ignore[assignment]
    CHUNKING_AVAILABLE = False


logger = logging.getLogger("myloware.core.knowledge.retrieval")

_KB_SEARCH_BUCKETS = (0.05, 0.1, 0.2, 0.5, 1, 2, 5)
kb_search_seconds = Histogram(
    "kb_search_seconds",
    "Latency of knowledge base searches (seconds)",
    labelnames=("project", "persona"),
    buckets=_KB_SEARCH_BUCKETS,
)

_EMBEDDING_CLIENT = None


def _connect(dsn: str) -> psycopg.Connection:
    return psycopg.connect(dsn, autocommit=True)


def _embed_texts(texts: Iterable[str], model: str = "text-embedding-3-small") -> List[List[float]]:
    text_list = list(texts)
    if not text_list:
        return []
    if not EMBEDDINGS_AVAILABLE:
        return _hash_embeddings(text_list)
    try:
        client = _get_embedding_client()
        if client is None:
            return _hash_embeddings(text_list)
        return client.embed(text_list, model=model)
    except Exception as exc:  # pragma: no cover - adapter failures fall back to hash embeddings
        logger.warning("Embedding adapter failed; falling back to deterministic hash", extra={"error": str(exc)})
        return _hash_embeddings(text_list)


def _get_embedding_client():
    global _EMBEDDING_CLIENT
    if _EMBEDDING_CLIENT is None and EMBEDDINGS_AVAILABLE and build_openai_embedding_client:
        _EMBEDDING_CLIENT = build_openai_embedding_client()
    return _EMBEDDING_CLIENT


def _hash_embeddings(texts: Iterable[str]) -> List[List[float]]:
    res: List[List[float]] = []
    for text in texts:
        h = hashlib.sha256(text.encode()).digest()
        arr = [float(b) / 255.0 for b in h] + [0.0] * (1536 - len(h))
        res.append(arr[:1536])
    return res


def ingest_kb(dsn: str, base_dir: str | Path) -> int:
    """Ingest markdown and JSON files into kb_documents/kb_embeddings."""
    dsn = _normalize_dsn(dsn)
    files = _collect_kb_files(base_dir)
    if not files:
        logger.info("No KB files found under %s", base_dir)
        return 0
    logger.info("Ingesting %s KB files", len(files))
    ingested = 0
    with _connect(dsn) as conn:
        for index, path in enumerate(files, start=1):
            logger.info("[%s/%s] Ingesting %s", index, len(files), path)
            try:
                project, persona = _project_persona_from_path(path)
                content = _load_kb_content(path)
                chunks = _chunk_kb_content(path, content)
                for chunk_content, chunk_suffix in chunks:
                    doc_id = str(uuid4())
                    chunk_path = str(path) + chunk_suffix
                    conn.execute(
                        "INSERT INTO kb_documents (id, project, persona, path, content) VALUES (%s, %s, %s, %s, %s)",
                        (doc_id, project, persona, chunk_path, chunk_content),
                    )
                    embedding = _embed_texts([chunk_content])[0]
                    values = ",".join(str(x) for x in embedding)
                    conn.execute(
                        f"INSERT INTO kb_embeddings (doc_id, embedding) VALUES (%s, '[{values}]')",
                        (doc_id,),
                    )
                    ingested += 1
            except Exception as exc:  # pragma: no cover - ingestion is best-effort
                logger.warning("Failed to ingest %s", path, extra={"error": str(exc)}, exc_info=True)
    return ingested


def search_kb(dsn: str, query: str, k: int = 5, project: str | None = None, persona: str | None = None) -> tuple[List[Tuple[str, str, float, str]], float]:
    """Search kb with cosine distance; returns (results, latency_ms).
    
    Results are tuples of (doc_id, path, score, snippet).
    """
    # Normalize SQLAlchemy URL format to plain psycopg format
    if dsn.startswith("postgresql+psycopg://"):
        dsn = dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    
    import time
    start_time = time.time()
    [qvec] = _embed_texts([query])
    qvalues = ",".join(str(x) for x in qvec)
    
    # Build WHERE clause for project/persona filtering
    where_clauses = []
    params: list[object] = [k]
    if project:
        where_clauses.append("(d.project = %s OR d.project IS NULL)")
        params.insert(-1, project)
    if persona:
        where_clauses.append("(d.persona = %s OR d.persona IS NULL)")
        params.insert(-1, persona)
    where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Embed the vector values directly in SQL since pgvector doesn't support parameterized vectors
    sql = f"""
    SELECT d.id::text, d.path, 1 - (e.embedding <=> q.embedding) AS score, substring(d.content from 1 for 240) AS snippet
    FROM kb_embeddings e
    JOIN kb_documents d ON d.id = e.doc_id,
    (SELECT '[{qvalues}]'::vector AS embedding) AS q
    WHERE 1=1 {where_sql}
    ORDER BY e.embedding <-> q.embedding
    LIMIT %s;
    """
    with _connect(dsn) as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
        latency_ms = (time.time() - start_time) * 1000
        # Observe latency in seconds for Prometheus consumers
        label_project = project or "all"
        label_persona = persona or "all"
        try:
            kb_search_seconds.labels(project=label_project, persona=label_persona).observe(latency_ms / 1000.0)
        except Exception:
            # Histogram observation should never break retrieval
            pass
        # Return (doc_id, path, score, snippet) for citation tracking
        results = [(r[0], r[1], float(r[2]), r[3]) for r in rows]
        return results, latency_ms


def search_by_category(dsn: str, query: str, category: str, k: int = 5) -> tuple[List[Tuple[str, str, float, str]], float]:
    """Search KB filtered by category (projects, personas, guardrails).
    
    This is a convenience wrapper around search_kb with path-based filtering.
    The actual filtering happens in the tool implementations.
    """
    return search_kb(dsn, query, k=k, project=None, persona=None)
def _normalize_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+psycopg://"):
        return dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    return dsn


def _collect_kb_files(base_dir: str | Path) -> list[Path]:
    base = Path(base_dir)
    md_files = sorted(base.glob("**/*.md"))
    json_files = sorted(base.glob("**/*.json"))
    return md_files + json_files


def _project_persona_from_path(path: Path) -> tuple[str | None, str | None]:
    path_str = str(path)
    project = next((proj for proj in ["aismr", "test_video_gen", "general"] if f"/projects/{proj}/" in path_str or f"/projects/{proj}.json" in path_str), None)
    persona = next((pers for pers in ["alex", "brendan", "iggy", "quinn", "riley"] if f"/personas/{pers}/" in path_str), None)
    return project, persona


def _load_kb_content(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        try:
            data = json.loads(text)
            formatted = ""
            if "name" in data:
                formatted = f"# {data.get('name', '')}\n\n"
            if "title" in data:
                formatted += f"## {data.get('title', '')}\n\n"
            if "description" in data:
                formatted += f"{data.get('description', '')}\n\n"
            formatted += f"```json\n{json.dumps(data, indent=2)}\n```"
            return formatted
        except Exception:
            logger.debug("Failed to format JSON file %s", path, exc_info=True)
    return text


def _chunk_kb_content(path: Path, content: str) -> list[tuple[str, str]]:
    if len(content) <= 24_000:
        return [(content, "")]
    if not CHUNKING_AVAILABLE or not RecursiveCharacterTextSplitter:
        logger.warning("Skipping %s: too large (%s chars) and chunking unavailable", path, len(content))
        return []
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=2000,
        chunk_overlap=200,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_text(content)
    logger.info("Chunked %s into %s pieces", path.name, len(chunks))
    return [(chunk_text, f"_chunk{idx}") for idx, chunk_text in enumerate(chunks)]
