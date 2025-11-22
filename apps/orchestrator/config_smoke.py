"""Config smoke checks for orchestrator and persona wiring.

The intent of this module is to provide a fast, centralized set of invariants
that can be exercised from CI (or via ``mw-py``) to catch misconfigurations
before they hit staging or production.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable

from .config import Settings, get_settings
from .startup_validations import validate_adapter_hosts
from . import persona_context

logger = logging.getLogger("myloware.orchestrator.config_smoke")


_REQUIRED_PERSONAS: set[str] = {"iggy", "riley", "alex", "quinn"}


def _iter_project_dirs() -> Iterable[Path]:
    projects_dir: Path = getattr(persona_context, "_PROJECTS_DIR")  # type: ignore[attr-defined]
    if not projects_dir.exists():
        raise RuntimeError(f"Projects directory not found at {projects_dir!s}")
    return [p for p in projects_dir.iterdir() if p.is_dir()]


def _validate_persona_expectations() -> None:
    """Validate that each project defines required personas and tool allowlists.

    This reuses the strict loaders in ``persona_context`` so that any missing
    or malformed configuration surfaces as a loud, actionable error.
    """

    errors: list[str] = []

    for project_dir in _iter_project_dirs():
        project = project_dir.name
        try:
            expectations = persona_context._load_agent_expectations(project)  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001 - bubble as config error
            errors.append(f"{project}: failed to load agent expectations: {exc}")
            continue

        personas = {str(name) for name in expectations.keys()}
        missing_personas = sorted(_REQUIRED_PERSONAS - personas)
        if missing_personas:
            errors.append(
                f"{project}: missing personas {', '.join(missing_personas)} in agent-expectations.json",
            )

        for persona in _REQUIRED_PERSONAS & personas:
            try:
                persona_context._load_allowed_tools(project, persona)  # type: ignore[attr-defined]
            except Exception as exc:  # noqa: BLE001 - bubble as config error
                errors.append(f"{project}:{persona}: invalid tools configuration: {exc}")

    if errors:
        message = "Config smoke checks failed:\n" + "\n".join(f"- {e}" for e in errors)
        logger.error(message)
        raise RuntimeError(message)


def run_config_smoke_checks(settings: Settings | None = None) -> None:
    """Run all orchestrator config smoke checks.

    Intended for use from CI and the ``mw-py validate config`` CLI command.
    """

    settings = settings or get_settings()
    logger.info("Running orchestrator config smoke checks", extra={"environment": settings.environment})
    # Adapter host validations (fail-fast in strict environments).
    validate_adapter_hosts(settings)
    # Persona expectations and allowlists.
    _validate_persona_expectations()
    logger.info("Config smoke checks passed", extra={"environment": settings.environment})


__all__ = ["run_config_smoke_checks"]

