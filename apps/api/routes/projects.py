"""Project metadata endpoints."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..projects import get_project_spec

router = APIRouter(prefix="/v1/projects", tags=["projects"])

_PROJECTS_DIR = Path(__file__).resolve().parents[3] / "data" / "projects"


class ProjectInfo(BaseModel):
    key: str
    title: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.get("/", response_model=list[ProjectInfo])
def list_projects() -> list[ProjectInfo]:
    """List available projects by inspecting data/projects directory."""
    if not _PROJECTS_DIR.exists():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="projects directory missing")
    results: list[ProjectInfo] = []
    for path in sorted(_PROJECTS_DIR.iterdir()):
        if path.is_file() and path.suffix == ".json":
            key = path.stem
        elif path.is_dir():
            key = path.name
        else:
            continue

        try:
            spec = get_project_spec(key)
        except FileNotFoundError:
            continue

        metadata = spec.get("metadata") or {}
        results.append(
            ProjectInfo(
                key=key,
                title=spec.get("title"),
                description=spec.get("description"),
                metadata=metadata if isinstance(metadata, dict) else {},
            )
        )
    return results


@router.get("/{project_key}", response_model=ProjectInfo)
def get_project(project_key: str) -> ProjectInfo:
    """Return details for a single project or 404 if missing."""
    try:
        spec = get_project_spec(project_key)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="project not found")

    metadata = spec.get("metadata") or {}
    return ProjectInfo(
        key=project_key,
        title=spec.get("title"),
        description=spec.get("description"),
        metadata=metadata if isinstance(metadata, dict) else {},
    )
