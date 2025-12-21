"""Path helpers for locating repo resources.

This repo is often run both as:
- an editable install (`pip install -e .`) where modules live under `src/`, and
- source checkout execution with `PYTHONPATH=src`.

Some runtime resources (e.g., `data/`, `pyproject.toml`) live outside the package
tree, so we provide a small helper to locate the repo root reliably.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_repo_root() -> Path:
    """Return the repository root (directory containing `pyproject.toml`).

    Falls back to the current working directory if a repo root cannot be found.
    """
    start = Path(__file__).resolve()
    for parent in (start, *start.parents):
        if (parent / "pyproject.toml").is_file():
            return parent
    return Path.cwd()
