"""Web research helpers for agents."""

from __future__ import annotations

from typing import Any, List

from myloware.observability.logging import get_logger

logger = get_logger("agents.research")

__all__ = ["format_search_context", "trending_topics_prompt"]


def format_search_context(search_results: List[dict[str, Any]]) -> str:
    """Format search results for agent context."""

    if not search_results:
        return "No search results found."

    lines = ["## Web Research Results\n"]

    for i, result in enumerate(search_results[:5], 1):
        title = result.get("title", "Untitled")
        url = result.get("url", "")
        snippet = result.get("snippet", result.get("description", ""))

        lines.append(f"### {i}. {title}")
        if url:
            lines.append(f"Source: {url}")
        if snippet:
            lines.append(f"{snippet}\n")

    return "\n".join(lines)


def trending_topics_prompt(category: str) -> str:
    """Generate a prompt to search for trending topics."""

    return f"trending {category} videos 2024 popular content ideas"
