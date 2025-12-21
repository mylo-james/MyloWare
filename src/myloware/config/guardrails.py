"""Project guardrails loader."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from myloware.paths import get_repo_root

ROOT = get_repo_root()


def get_guardrails_dir(project_name: str) -> Path:
    """Get guardrails directory for a project."""

    return ROOT / "data" / "projects" / project_name / "guardrails"


def load_guardrails(project_name: str) -> Dict[str, Any]:
    """Load all guardrails for a project.

    Returns:
        Dict mapping guardrail filename (stem) to loaded JSON content.
    """

    guardrails_dir = get_guardrails_dir(project_name)
    if not guardrails_dir.exists():
        return {}

    guardrails: Dict[str, Any] = {}
    for file_path in guardrails_dir.glob("*.json"):
        guardrails[file_path.stem] = json.loads(file_path.read_text())
    return guardrails


def get_guardrail_summary(project_name: str) -> str:
    """Get human-readable guardrail summary for agent context."""

    guardrails = load_guardrails(project_name)
    if not guardrails:
        return ""

    lines = ["\n## Project Guardrails\n"]
    for category, rules in sorted(guardrails.items()):
        title = category.replace(".", " ").replace("_", " ").title()
        description = rules.get("description") if isinstance(rules, dict) else None
        if not description and isinstance(rules, dict):
            description = rules.get("rule") or str(rules)
        if not description:
            description = str(rules)
        lines.append(f"- **{title}**: {description}")

    return "\n".join(lines)


__all__ = [
    "get_guardrails_dir",
    "load_guardrails",
    "get_guardrail_summary",
]
