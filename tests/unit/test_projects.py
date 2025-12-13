"""Tests for project configuration loading."""

from __future__ import annotations

import pytest

from config.projects import (
    clear_cache,
    get_project_specs,
    get_project_workflow,
    list_projects,
    load_project,
)


def test_load_test_video_gen():
    clear_cache()
    project = load_project("test_video_gen")
    assert project.name == "test_video_gen"
    assert project.title == "Test Video Generation"
    assert project.workflow == ["ideator", "producer", "editor", "publisher"]
    assert project.hitl_gates == []
    assert project.settings.test_mode is True
    assert project.specs.video_count == 2


def test_load_aismr():
    clear_cache()
    project = load_project("aismr")
    assert project.name == "aismr"
    assert "ideation" in project.hitl_gates
    assert "publish" in project.hitl_gates
    assert project.settings.auto_approve_hitl is False


def test_list_projects_contains_configs():
    projects = list_projects()
    assert "test_video_gen" in projects
    assert "aismr" in projects


def test_invalid_project_raises():
    clear_cache()
    with pytest.raises(FileNotFoundError):
        load_project("does_not_exist")


def test_helpers_return_specs_and_workflow():
    clear_cache()
    workflow = get_project_workflow("test_video_gen")
    specs = get_project_specs("test_video_gen")
    assert workflow[0] == "ideator"
    assert specs.resolution == "1080x1920"
