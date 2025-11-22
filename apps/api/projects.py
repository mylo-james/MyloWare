"""Helpers to load project specifications."""
from __future__ import annotations

import json
from functools import lru_cache
import os
from pathlib import Path
from typing import Any, Mapping


def _resolve_projects_dir() -> Path:
    # 1) Explicit override
    override = os.getenv("PROJECTS_DIR")
    if override:
        p = Path(override)
        if p.exists():
            return p
    # 2) Common container path
    p = Path("/app/data/projects")
    if p.exists():
        return p
    # 3) CWD-relative (dev, tests)
    p = Path.cwd() / "data" / "projects"
    if p.exists():
        return p
    # 4) Fallback near installed module (rarely valid once packaged)
    p = Path(__file__).resolve().parents[3] / "data" / "projects"
    return p


_PROJECTS_DIR = _resolve_projects_dir()


@lru_cache(maxsize=None)
def get_project_spec(project: str) -> Mapping[str, Any]:
    """Load the project specification JSON for the given project key."""

    path = _PROJECTS_DIR / project / "project.json"
    if not path.exists():
        raise FileNotFoundError(f"Project spec not found for {project}")
    with path.open("r", encoding="utf-8") as handle:
        spec: dict[str, Any] = json.load(handle)
    if "hitlPoints" not in spec:
        hitl_points = spec.get("settings", {}).get("hitlPoints")
        if isinstance(hitl_points, list):
            spec["hitlPoints"] = hitl_points
    return spec
