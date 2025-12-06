"""MyloWare configuration module."""

from config.settings import settings, Settings
from config.guardrails import (
    get_guardrails_dir,
    get_guardrail_summary,
    load_guardrails,
)
from config.projects import (
    load_project,
    list_projects,
    get_project_workflow,
    get_project_specs,
    ProjectConfig,
    ProjectSpecs,
)
from config.loaders import (
    load_project_config,
    load_workflow_config,
    load_agent_config,
    deep_merge,
    list_available_projects,
)

__all__ = [
    "settings",
    "Settings",
    "get_guardrails_dir",
    "get_guardrail_summary",
    "load_guardrails",
    "load_project",
    "list_projects",
    "get_project_workflow",
    "get_project_specs",
    "ProjectConfig",
    "ProjectSpecs",
    # New loaders
    "load_project_config",
    "load_workflow_config",
    "load_agent_config",
    "deep_merge",
    "list_available_projects",
]
