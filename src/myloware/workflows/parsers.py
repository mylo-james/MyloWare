"""Parsing utilities for workflow data."""

from __future__ import annotations

import json
import re
from typing import Any, Dict

from myloware.observability.logging import get_logger

logger = get_logger(__name__)


def parse_structured_ideation(ideas_text: str) -> Dict[str, Any] | None:
    """Extract structured JSON from ideation output.

    The ideator outputs markdown followed by a JSON block.
    Returns the parsed JSON or None if not found.
    """
    # Look for JSON block in the ideation text
    # Pattern: ```json ... ``` or just { ... } at the end
    json_patterns = [
        r"```json\s*(\{[\s\S]*?\})\s*```",  # Fenced JSON block
        r'```\s*(\{[\s\S]*?"ideas"[\s\S]*?\})\s*```',  # Generic fenced block with "ideas"
        r'(\{[\s\S]*?"ideas"\s*:\s*\[[\s\S]*?\]\s*\})',  # Bare JSON with ideas array
    ]

    for pattern in json_patterns:
        match = re.search(pattern, ideas_text)
        if match:
            try:
                parsed = json.loads(match.group(1))
                if "ideas" in parsed and isinstance(parsed["ideas"], list):
                    logger.info("Parsed structured ideation with %d ideas", len(parsed["ideas"]))
                    return parsed
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse ideation JSON: %s", e)
                continue

    logger.warning("No structured JSON found in ideation output")
    return None


def extract_topic_from_brief(brief: str) -> str:
    """Extract the core topic from a brief for cache matching.

    Examples:
    - "run aismr about puppies" -> "puppies"
    - "Create an ASMR video featuring puppies" -> "puppies"
    - "puppies" -> "puppies"
    """
    brief_lower = brief.lower().strip()

    # Common patterns to strip
    patterns = [
        "run aismr about ",
        "create an asmr video about ",
        "create an asmr video featuring ",
        "make an asmr video about ",
        "asmr video about ",
        "asmr video featuring ",
        "asmr about ",
        "about ",
    ]

    for pattern in patterns:
        if brief_lower.startswith(pattern):
            topic = brief_lower[len(pattern) :].strip()
            # Clean up trailing punctuation
            return topic.rstrip(".,!?")

    # If no pattern matched, look for "about" or "featuring" anywhere
    for marker in ["about ", "featuring "]:
        if marker in brief_lower:
            topic = brief_lower.split(marker)[-1].strip()
            # Clean up trailing punctuation
            topic = topic.rstrip(".,!?")
            return topic

    # Fallback: use the last word as topic
    words = brief_lower.split()
    if words:
        return words[-1].rstrip(".,!?")

    return brief_lower


def extract_overlays_motivational(ideas_text: str) -> list[dict[str, Any]]:
    """Extract standardized overlays from motivational video ideation.

    Returns list of overlay dicts with:
    - identifier: segment label (e.g., "Part 1")
    - start_s: start time in seconds
    - end_s: end time in seconds
    - text: visual text overlay
    - voice_over: audio script (optional)
    """
    clean = re.sub(r"```[a-z]*\n?", "", ideas_text).strip()
    overlays = []

    # Extract text overlays with timing: (0-4s): "TEXT"
    time_pattern = r'\((\d+)-(\d+)s\):\s*"([^"]+)"'
    matches = re.findall(time_pattern, clean)

    for i, (start, end, text) in enumerate(matches[:4]):
        overlays.append(
            {
                "identifier": f"Part {i + 1}",
                "start_s": int(start),
                "end_s": int(end),
                "text": text.strip(),
                "voice_over": None,  # Could extract from Voice Over sections
            }
        )

    # Try to extract voice overs
    voice_pattern = r'\*\*Voice Over:\*\*\s*"([^"]+)"'
    voice_matches = re.findall(voice_pattern, clean)

    # Assign voice overs to overlays (2 per video section)
    for i, voice in enumerate(voice_matches[:2]):
        # Each video has 2 overlays
        if i * 2 < len(overlays):
            overlays[i * 2]["voice_over"] = voice
        if i * 2 + 1 < len(overlays):
            overlays[i * 2 + 1]["voice_over"] = voice

    if overlays:
        logger.info("Extracted %d overlays for motivational video", len(overlays))
    else:
        logger.warning("No overlays found in motivational ideation")

    return overlays


def extract_overlays_aismr(ideas_text: str, zodiac_objects: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract standardized overlays from AISMR ideation.

    Returns list of overlay dicts with:
    - identifier: zodiac sign name
    - start_s: calculated from clip index (6s offset with 2s overlap)
    - end_s: start + 8s clip duration
    - text: creative object name
    - voice_over: None (ASMR is visual-focused)
    """
    ZODIAC_SIGNS = [
        "Aries",
        "Taurus",
        "Gemini",
        "Cancer",
        "Leo",
        "Virgo",
        "Libra",
        "Scorpio",
        "Sagittarius",
        "Capricorn",
        "Aquarius",
        "Pisces",
    ]

    overlays = []
    for i, sign in enumerate(ZODIAC_SIGNS):
        obj = zodiac_objects.get(sign, {})
        object_name = obj.get("object", sign)

        # AISMR timing: 6s offset between clips, 8s duration each
        start_s = i * 6

        overlays.append(
            {
                "identifier": sign,
                "start_s": start_s,
                "end_s": start_s + 8,
                "text": object_name,
                "voice_over": None,
            }
        )

    logger.info("Created %d overlays for AISMR video", len(overlays))
    return overlays
