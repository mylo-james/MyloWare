"""Project configuration loader."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from myloware.paths import get_repo_root

ROOT = get_repo_root()


class VideoSpec(BaseModel):
    """Individual video specification."""

    subject: str
    header: Optional[str] = None
    prompt: Optional[str] = None


class EditingConfig(BaseModel):
    """Video editing configuration."""

    concat_order: List[str] = Field(default_factory=list)
    transitions: str = "cut"
    overlay_style: Dict[str, Any] = Field(default_factory=dict)


class ProjectSpecs(BaseModel):
    """Project video specifications."""

    video_count: int = 1
    video_duration: float = 8.0
    videos: List[VideoSpec] = Field(default_factory=list)
    compilation_length: int = 30
    format: str = "9:16 vertical"
    aspect_ratio: str = "9:16"
    resolution: str = "1080x1920"
    editing: EditingConfig = Field(default_factory=EditingConfig)
    style: Dict[str, Any] = Field(default_factory=dict)


class ProjectSettings(BaseModel):
    """Project runtime settings."""

    test_mode: bool = False
    auto_approve_hitl: bool = False


class ProjectConfig(BaseModel):
    """Complete project configuration."""

    name: str
    title: str
    description: str = ""
    workflow: List[str]
    hitl_gates: List[str] = Field(default_factory=list)
    specs: ProjectSpecs = Field(default_factory=ProjectSpecs)
    platforms: List[str] = Field(default_factory=lambda: ["tiktok"])
    overlay_extractor: Optional[str] = Field(
        default=None, description="Registered overlay extractor name"
    )
    object_validator: Optional[str] = Field(
        default=None, description="Registered object validator name (e.g., 'aismr_objects')"
    )
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    guardrails: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    publisher_prompt_template: Optional[str] = Field(
        default=None,
        description="Custom publisher prompt template. Use {video_url} and {topic} placeholders. If not set, uses default neutral prompt.",
    )

    @field_validator("workflow")
    @classmethod
    def validate_workflow(cls, v: List[str]) -> List[str]:
        valid_personas = {"ideator", "producer", "editor", "publisher", "supervisor"}
        for persona in v:
            if persona not in valid_personas:
                raise ValueError(f"Invalid persona in workflow: {persona}")
        return v

    @field_validator("hitl_gates")
    @classmethod
    def validate_hitl_gates(cls, v: List[str]) -> List[str]:
        valid_gates = {"ideation", "publish"}
        for gate in v:
            if gate not in valid_gates:
                raise ValueError(f"Invalid HITL gate: {gate}")
        return v


_project_cache: Dict[str, ProjectConfig] = {}


def get_projects_dir() -> Path:
    """Get the projects data directory."""

    projects_dir = ROOT / "data" / "projects"
    if not projects_dir.exists():
        raise FileNotFoundError(f"Projects directory not found: {projects_dir}")
    return projects_dir


def load_project(project_name: str) -> ProjectConfig:
    """Load a project configuration by name."""

    if project_name in _project_cache:
        return _project_cache[project_name]

    config_path = get_projects_dir() / f"{project_name}.json"
    if not config_path.exists():
        raise FileNotFoundError(f"Project not found: {project_name}")

    data = json.loads(config_path.read_text())
    config = ProjectConfig(**data)
    _project_cache[project_name] = config
    return config


def list_projects() -> List[str]:
    """List available project names."""

    return [p.stem for p in get_projects_dir().glob("*.json") if not p.name.startswith("_")]


def get_project_workflow(project_name: str) -> List[str]:
    return load_project(project_name).workflow


def get_project_specs(project_name: str) -> ProjectSpecs:
    return load_project(project_name).specs


def clear_cache() -> None:
    _project_cache.clear()


__all__ = [
    "ProjectConfig",
    "ProjectSpecs",
    "VideoSpec",
    "EditingConfig",
    "ProjectSettings",
    "load_project",
    "list_projects",
    "get_project_workflow",
    "get_project_specs",
    "get_projects_dir",
    "clear_cache",
]
