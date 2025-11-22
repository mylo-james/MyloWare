from __future__ import annotations

import random
import re


def project_prefix(project: str | None) -> str:
    if not project:
        return "RUN"
    parts = re.split(r"[_\-\s]+", project)
    letters = "".join(p[:1] for p in parts if p)
    letters = (letters or project)[:3]
    return letters.upper()


def generate_job_code(project: str | None = None) -> str:
    """Generate a short human-friendly job code.

    Pattern: <PREFIX><AAA><DDD>, e.g., TVGQX7 or TVG-AQ2 (we'll keep simple: PREFIX + 3 letters + 3 digits)
    """
    pref = project_prefix(project)
    letters = "".join(random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(3))
    digits = "".join(random.choice("0123456789") for _ in range(3))
    return f"{pref}{letters}{digits}"

__all__ = ["generate_job_code", "project_prefix"]

