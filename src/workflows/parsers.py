"""Parsing utilities for workflow data."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict

logger = logging.getLogger(__name__)


def parse_structured_ideation(ideas_text: str) -> Dict[str, Any] | None:
    """Extract structured JSON from ideation output.
    
    The ideator outputs markdown followed by a JSON block.
    Returns the parsed JSON or None if not found.
    """
    # Look for JSON block in the ideation text
    # Pattern: ```json ... ``` or just { ... } at the end
    json_patterns = [
        r'```json\s*(\{[\s\S]*?\})\s*```',  # Fenced JSON block
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
            return brief_lower[len(pattern):].strip()
    
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

