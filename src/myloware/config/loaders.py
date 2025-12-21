"""Configuration loaders with inheritance support.

This module provides functions to load project and agent configurations
from YAML files with support for base + override inheritance patterns.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml  # type: ignore

from myloware.observability.logging import get_logger
from myloware.paths import get_repo_root

logger = get_logger("config.loaders")

__all__ = [
    "load_project_config",
    "load_workflow_config",
    "load_agent_config",
    "deep_merge",
    "DATA_PATH",
    "SHARED_PATH",
    "PROJECTS_PATH",
]

# Path configuration - relative to project root
DATA_PATH = get_repo_root() / "data"
SHARED_PATH = DATA_PATH / "shared"
PROJECTS_PATH = DATA_PATH / "projects"


def load_yaml(path: Path) -> dict[str, Any]:
    """Load a YAML file.

    Args:
        path: Path to the YAML file

    Returns:
        Parsed YAML content as dict

    Raises:
        FileNotFoundError: If file doesn't exist
        yaml.YAMLError: If YAML parsing fails
    """
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")

    with open(path) as f:
        content = yaml.safe_load(f)
        return content if content else {}


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Deep merge override dict into base dict.

    For nested dicts, recursively merges. For other types, override wins.

    Args:
        base: Base configuration dict
        override: Override configuration dict

    Returns:
        Merged configuration dict
    """
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_project_config(project_name: str) -> dict[str, Any]:
    """Load project configuration from JSON file.

    Args:
        project_name: Name of the project (e.g., "aismr", "motivational")

    Returns:
        Project configuration dict

    Raises:
        FileNotFoundError: If project config doesn't exist
    """
    # Try JSON first (existing format)
    json_path = PROJECTS_PATH / f"{project_name}.json"
    if json_path.exists():
        import json

        with open(json_path) as f:
            return json.load(f)

    # Fall back to YAML
    yaml_path = PROJECTS_PATH / project_name / "config.yaml"
    if yaml_path.exists():
        return load_yaml(yaml_path)

    raise FileNotFoundError(f"Project config not found: {project_name}")


def load_workflow_config(project_name: str) -> dict[str, Any]:
    """Load project workflow configuration.

    Args:
        project_name: Name of the project

    Returns:
        Workflow configuration dict

    Raises:
        FileNotFoundError: If workflow config doesn't exist
    """
    workflow_path = PROJECTS_PATH / project_name / "workflow.yaml"
    if not workflow_path.exists():
        raise FileNotFoundError(f"Workflow config not found: {workflow_path}")
    return load_yaml(workflow_path)


def load_agent_config(project_name: str, role: str) -> dict[str, Any]:
    """Load agent config with inheritance (base + project override).

    Loads the base agent config from data/shared/agents/{role}.yaml,
    then merges any project-specific override from
    data/projects/{project}/agents/{role}.yaml.

    Args:
        project_name: Name of the project
        role: Agent role (ideator, producer, editor, publisher, supervisor)

    Returns:
        Merged agent configuration

    Raises:
        FileNotFoundError: If base agent config doesn't exist
    """
    # Load base config (required)
    base_path = SHARED_PATH / "agents" / f"{role}.yaml"
    if not base_path.exists():
        raise FileNotFoundError(f"Base agent config not found: {base_path}")

    base = load_yaml(base_path)
    logger.debug("Loaded base config for %s", role)

    # Load project override if exists
    override_path = PROJECTS_PATH / project_name / "agents" / f"{role}.yaml"
    if override_path.exists():
        override = load_yaml(override_path)
        logger.debug("Applying override for %s/%s", project_name, role)
        base = deep_merge(base, override)

    return base


def list_available_projects() -> list[str]:
    """List all available project names.

    Returns:
        List of project names
    """
    projects = []

    # Check for JSON configs
    for json_file in PROJECTS_PATH.glob("*.json"):
        if json_file.stem != "__init__":
            projects.append(json_file.stem)

    # Check for directory-based configs
    for project_dir in PROJECTS_PATH.iterdir():
        if project_dir.is_dir() and (project_dir / "config.yaml").exists():
            if project_dir.name not in projects:
                projects.append(project_dir.name)

    return sorted(projects)
