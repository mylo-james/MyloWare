"""Overlay extractor registry.

Extractors transform raw ideation output into standardized overlay lists
for video rendering. Each project can specify its extractor in config.
"""

from __future__ import annotations

from typing import Any, Callable

from myloware.workflows.parsers import extract_overlays_aismr, extract_overlays_motivational

ExtractorFn = Callable[[str, dict[str, Any] | None], list[Any] | None]


def _aismr_extractor(ideas: str, structured: dict[str, Any] | None) -> list[Any] | None:
    """AISMR extractor: requires structured ideation with zodiac-object mapping."""
    if not structured:
        return None
    zodiac_objects = {item.get("sign", ""): item for item in structured.get("ideas", [])}
    return extract_overlays_aismr(ideas, zodiac_objects)


def _motivational_extractor(ideas: str, structured: dict[str, Any] | None) -> list[Any] | None:
    """Motivational extractor: parses timing patterns from raw ideation text."""
    return extract_overlays_motivational(ideas)


EXTRACTORS: dict[str, ExtractorFn] = {
    "aismr": _aismr_extractor,
    "motivational": _motivational_extractor,
}


def get_extractor(name: str) -> ExtractorFn | None:
    return EXTRACTORS.get(name)
