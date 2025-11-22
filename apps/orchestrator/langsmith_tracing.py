"""Thin helpers for LangSmith run-tree instrumentation."""
from __future__ import annotations

import logging
from typing import Any

try:
    from langsmith.run_trees import RunTree
    LANGSMITH_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    RunTree = Any  # type: ignore
    LANGSMITH_AVAILABLE = False

from .config import settings

logger = logging.getLogger("myloware.orchestrator.langsmith")


def start_langsmith_run(
    name: str,
    inputs: dict[str, Any],
    *,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> RunTree | None:
    """Start and POST a LangSmith run tree when API key/project configured.

    This uses the RunTree pattern recommended by the LangSmith SDK so that
    runs appear in the UI as soon as Brendan starts them.
    """

    if not LANGSMITH_AVAILABLE:
        return None
    if not settings.langsmith_api_key:
        return None
    try:
        run = RunTree(
            name=name,
            inputs=inputs,
            tags=tags or [],
            metadata=metadata or {},  # type: ignore[call-arg]
            project_name=settings.langsmith_project,
            run_type="chain",
        )
        # Make the run visible immediately when supported by the SDK stub
        post = getattr(run, "post", None)
        if callable(post):
            post()
        return run
    except Exception as exc:  # pragma: no cover - best-effort tracing
        logger.warning("Failed to start LangSmith run", exc_info=exc)
        return None


def end_langsmith_run(
    run: RunTree | None,
    *,
    outputs: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Finish and PATCH a LangSmith run tree when available."""

    if not run:
        return
    try:
        run.end(outputs=outputs, error=error)
        # Flush final state
        run.patch()
    except Exception as exc:  # pragma: no cover - best-effort tracing
        logger.warning("Failed to finish LangSmith run", exc_info=exc)


def start_langsmith_child_run(
    parent: RunTree | None,
    *,
    name: str,
    run_type: str,
    inputs: dict[str, Any],
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> RunTree | None:
    """Create and POST a child run under a parent run."""

    if parent is None:
        return None
    try:
        child = parent.create_child(
            name=name,
            run_type=run_type,
            inputs=inputs,
            tags=tags or [],
            metadata=metadata or {},
        )
        post = getattr(child, "post", None)
        if callable(post):
            post()
        return child
    except Exception as exc:  # pragma: no cover - best-effort tracing
        logger.warning("Failed to start LangSmith child run", exc_info=exc)
        return None


def end_langsmith_child_run(
    child: RunTree | None,
    *,
    outputs: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Finish and PATCH a LangSmith child run."""

    if child is None:
        return
    try:
        child.end(outputs=outputs, error=error)
        child.patch()
    except Exception as exc:  # pragma: no cover - best-effort tracing
        logger.warning("Failed to finish LangSmith child run", exc_info=exc)
