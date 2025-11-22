from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from apps.api.config import settings
from apps.api.main import app
import apps.api.projects as projects_module
import apps.api.routes.projects as routes_module


@pytest.fixture()
def temp_projects_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Create a temporary projects directory and point both modules at it."""
    projects_dir = tmp_path / "projects"
    projects_dir.mkdir()

    demo_spec = {
        "title": "Demo Project",
        "description": "Demo project for tests",
        "metadata": {"category": "demo"},
        "hitlPoints": ["ideate", "prepublish"],
    }
    demo_dir = projects_dir / "demo"
    demo_dir.mkdir()
    (demo_dir / "project.json").write_text(json.dumps(demo_spec), encoding="utf-8")

    # Point both the loader and the route module at the temp directory.
    monkeypatch.setattr(projects_module, "_PROJECTS_DIR", projects_dir, raising=False)
    monkeypatch.setattr(routes_module, "_PROJECTS_DIR", projects_dir, raising=False)
    # Clear cache so get_project_spec picks up the new directory.
    projects_module.get_project_spec.cache_clear()

    try:
        yield projects_dir
    finally:
        projects_module.get_project_spec.cache_clear()


@pytest.mark.asyncio
async def test_list_projects_returns_entries(temp_projects_dir: Path) -> None:  # noqa: ARG001
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1/projects/", headers={"x-api-key": settings.api_key})

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1
    project = data[0]
    assert project["key"] == "demo"
    assert project["title"] == "Demo Project"
    assert project["metadata"]["category"] == "demo"


@pytest.mark.asyncio
async def test_get_project_returns_single_project(temp_projects_dir: Path) -> None:  # noqa: ARG001
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1/projects/demo", headers={"x-api-key": settings.api_key})

    assert response.status_code == 200
    body = response.json()
    assert body["key"] == "demo"
    assert body["title"] == "Demo Project"
    assert body["description"] == "Demo project for tests"


@pytest.mark.asyncio
async def test_get_project_missing_returns_404(temp_projects_dir: Path) -> None:  # noqa: ARG001
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1/projects/missing", headers={"x-api-key": settings.api_key})

    assert response.status_code == 404


def test_get_project_spec_infers_hitl_points_from_settings(temp_projects_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure get_project_spec populates hitlPoints from settings when missing."""
    import apps.api.projects as projects_module

    fallback_dir = temp_projects_dir / "fallback"
    fallback_dir.mkdir()
    spec = {
        "title": "Fallback Project",
        "description": "Uses settings.hitlPoints",
        "settings": {"hitlPoints": ["after_iggy", "before_quinn"]},
        "metadata": {"category": "demo"},
    }
    (fallback_dir / "project.json").write_text(json.dumps(spec), encoding="utf-8")

    # Clear cache so the new spec is loaded.
    projects_module.get_project_spec.cache_clear()
    loaded = projects_module.get_project_spec("fallback")

    assert loaded["title"] == "Fallback Project"
    assert loaded.get("hitlPoints") == ["after_iggy", "before_quinn"]
