from __future__ import annotations

from typing import Any, Mapping


def evaluate_content_safety(result: Mapping[str, Any]) -> dict[str, Any]:
    """Very small, non-LLM heuristic for content safety.

    For now this is intentionally minimal: it marks a run as unsafe when the
    publish caption includes obviously blocked markers. The full classification
    logic can be swapped later without changing the API.
    """
    text_fragments: list[str] = []
    publish_urls = result.get("publishUrls") or result.get("publish_urls") or []
    if isinstance(publish_urls, list):
        text_fragments.extend(str(url) for url in publish_urls)
    videos = result.get("videos") or []
    if isinstance(videos, list):
        for video in videos:
            if isinstance(video, Mapping):
                for key in ("caption", "header", "subject", "prompt"):
                    value = video.get(key)
                    if isinstance(value, str):
                        text_fragments.append(value)
    joined = " ".join(fragment.lower() for fragment in text_fragments)
    unsafe_markers = ["forbidden", "nsfw", "illegal"]
    flagged = any(marker in joined for marker in unsafe_markers)
    return {
        "allowed": not flagged,
        "flagged": flagged,
        "markers": unsafe_markers if flagged else [],
    }

