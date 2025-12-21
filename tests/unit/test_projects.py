"""Tests for project configuration loading."""

from __future__ import annotations

import pytest

from myloware.config.projects import (
    clear_cache,
    get_project_specs,
    get_project_workflow,
    list_projects,
    load_project,
)


def test_load_aismr():
    clear_cache()
    project = load_project("aismr")
    assert project.name == "aismr"
    assert "ideation" in project.hitl_gates
    assert "publish" in project.hitl_gates
    assert project.settings.auto_approve_hitl is False


def test_load_motivational():
    clear_cache()
    project = load_project("motivational")
    assert project.name == "motivational"
    assert "ideation" in project.hitl_gates
    assert "publish" in project.hitl_gates
    assert project.specs.compilation_length == 16


def test_list_projects_contains_configs():
    projects = list_projects()
    assert "motivational" in projects
    assert "aismr" in projects


def test_invalid_project_raises():
    clear_cache()
    with pytest.raises(FileNotFoundError):
        load_project("does_not_exist")


def test_helpers_return_specs_and_workflow():
    clear_cache()
    workflow = get_project_workflow("motivational")
    specs = get_project_specs("motivational")
    assert workflow[0] == "ideator"
    assert specs.resolution == "1080x1920"
