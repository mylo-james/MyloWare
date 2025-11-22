"""Persona guidance loader using RAG (pgvector) with file fallback."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from core.knowledge.retrieval import search_kb

logger = logging.getLogger("myloware.content.personas.guidance")


def _normalize_dsn(dsn: str) -> str:
    """Convert SQLAlchemy-style DSN to psycopg-compatible."""
    if dsn.startswith("postgresql+"):
        return dsn.replace("postgresql+psycopg", "postgresql", 1)
    return dsn

_PERSONAS_DIR = Path(__file__).resolve().parents[2] / "data" / "personas"


def load_persona_guidance(
    *,
    persona: str,
    project: str | None = None,
    dsn: str | None = None,
    use_rag: bool = True,
    max_chars: int = 500,
) -> str:
    """Load persona guidance from vector DB (RAG) or fallback to file.
    
    Args:
        persona: Persona name (e.g., "iggy", "alex")
        project: Optional project filter for RAG search
        dsn: Database connection string (required if use_rag=True)
        use_rag: Whether to query vector DB first (default: True)
        max_chars: Maximum characters to return (truncates if needed)
    
    Returns:
        Concatenated guidance text, truncated to max_chars
    """
    guidance_parts: list[str] = []
    
    if use_rag and dsn:
        try:
            # Normalize DSN for psycopg compatibility
            normalized_dsn = _normalize_dsn(dsn)
            # Query for persona-specific guidance
            query = f"{persona} persona guidance workflow instructions"
            results, _latency = search_kb(
                dsn=normalized_dsn,
                query=query,
                k=3,
                project=project,
                persona=persona,
            )
            
            if results:
                # Extract snippets from top results
                for _doc_id, path, score, snippet in results:
                    if score > 0.5:  # Minimum similarity threshold
                        guidance_parts.append(snippet.strip())
                        if len(" ".join(guidance_parts)) >= max_chars:
                            break
                
                if guidance_parts:
                    logger.debug(
                        f"Loaded {len(results)} persona guidance chunks for {persona}",
                        extra={"persona": persona, "project": project, "chunks": len(results)},
                    )
        except Exception as exc:
            logger.warning(
                f"RAG lookup failed for {persona}, falling back to file",
                extra={"persona": persona, "error": str(exc)},
            )
    
    # Fallback to file-based persona prompt
    if not guidance_parts:
        try:
            prompt_path = _PERSONAS_DIR / persona / "prompt.md"
            if prompt_path.exists():
                content = prompt_path.read_text(encoding="utf-8")
                # Extract first meaningful paragraph (skip headers)
                lines = content.split("\n")
                meaningful = [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]
                if meaningful:
                    # Take first 2-3 sentences or up to max_chars
                    fallback_text = " ".join(meaningful[:3])
                    if len(fallback_text) > max_chars:
                        fallback_text = fallback_text[:max_chars].rsplit(".", 1)[0] + "."
                    guidance_parts.append(fallback_text)
                    logger.debug(f"Loaded persona guidance from file for {persona}")
        except Exception as exc:
            logger.warning(f"File fallback failed for {persona}", extra={"error": str(exc)})
    
    combined = " ".join(guidance_parts).strip()
    if len(combined) > max_chars:
        # Truncate at sentence boundary
        truncated = combined[:max_chars].rsplit(".", 1)[0] + "."
        return truncated
    
    return combined
