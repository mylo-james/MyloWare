"""Unit tests for configuration loaders (YAML/JSON + inheritance)."""

from __future__ import annotations

import json

import pytest


def test_deep_merge_merges_nested_dicts() -> None:
    from myloware.config.loaders import deep_merge

    base = {"a": {"x": 1, "y": 2}, "b": 1}
    override = {"a": {"y": 3}, "c": 9}
    assert deep_merge(base, override) == {"a": {"x": 1, "y": 3}, "b": 1, "c": 9}


def test_load_yaml_missing_file_raises(tmp_path) -> None:
    from myloware.config.loaders import load_yaml

    with pytest.raises(FileNotFoundError):
        load_yaml(tmp_path / "missing.yaml")


def test_load_project_config_prefers_json_then_yaml(monkeypatch, tmp_path) -> None:
    from myloware.config import loaders as mod

    # Patch module paths to an isolated temp tree.
    monkeypatch.setattr(mod, "DATA_PATH", tmp_path)
    monkeypatch.setattr(mod, "SHARED_PATH", tmp_path / "shared")
    monkeypatch.setattr(mod, "PROJECTS_PATH", tmp_path / "projects")
    mod.PROJECTS_PATH.mkdir(parents=True, exist_ok=True)

    # JSON format: projects/{project}.json
    json_path = mod.PROJECTS_PATH / "p1.json"
    json_path.write_text(json.dumps({"k": "v"}))
    assert mod.load_project_config("p1") == {"k": "v"}

    # YAML fallback: projects/{project}/config.yaml
    proj_dir = mod.PROJECTS_PATH / "p2"
    proj_dir.mkdir()
    (proj_dir / "config.yaml").write_text("k: v\n")
    assert mod.load_project_config("p2") == {"k": "v"}

    with pytest.raises(FileNotFoundError):
        mod.load_project_config("missing")


def test_load_workflow_config_requires_file(monkeypatch, tmp_path) -> None:
    from myloware.config import loaders as mod

    monkeypatch.setattr(mod, "PROJECTS_PATH", tmp_path / "projects")
    mod.PROJECTS_PATH.mkdir(parents=True, exist_ok=True)

    with pytest.raises(FileNotFoundError):
        mod.load_workflow_config("p1")

    proj_dir = mod.PROJECTS_PATH / "p1"
    proj_dir.mkdir()
    (proj_dir / "workflow.yaml").write_text("a: 1\n")
    assert mod.load_workflow_config("p1") == {"a": 1}


def test_load_agent_config_merges_project_override(monkeypatch, tmp_path) -> None:
    from myloware.config import loaders as mod

    monkeypatch.setattr(mod, "DATA_PATH", tmp_path)
    monkeypatch.setattr(mod, "SHARED_PATH", tmp_path / "shared")
    monkeypatch.setattr(mod, "PROJECTS_PATH", tmp_path / "projects")

    base_dir = mod.SHARED_PATH / "agents"
    base_dir.mkdir(parents=True)
    (base_dir / "ideator.yaml").write_text("instructions: base\ntools:\n  - a\nmeta:\n  x: 1\n")

    # No override -> base only
    (mod.PROJECTS_PATH / "p1").mkdir(parents=True)
    cfg = mod.load_agent_config("p1", "ideator")
    assert cfg["instructions"] == "base"
    assert cfg["tools"] == ["a"]
    assert cfg["meta"]["x"] == 1

    # With override -> deep merge
    override_dir = mod.PROJECTS_PATH / "p2" / "agents"
    override_dir.mkdir(parents=True)
    (override_dir / "ideator.yaml").write_text("tools:\n  - b\nmeta:\n  y: 2\n")
    cfg2 = mod.load_agent_config("p2", "ideator")
    assert cfg2["tools"] == ["b"]
    assert cfg2["meta"] == {"x": 1, "y": 2}

    with pytest.raises(FileNotFoundError):
        mod.load_agent_config("p1", "missing-role")


def test_list_available_projects_includes_json_and_yaml_dirs(monkeypatch, tmp_path) -> None:
    from myloware.config import loaders as mod

    monkeypatch.setattr(mod, "PROJECTS_PATH", tmp_path / "projects")
    mod.PROJECTS_PATH.mkdir(parents=True, exist_ok=True)

    (mod.PROJECTS_PATH / "a.json").write_text("{}")
    (mod.PROJECTS_PATH / "__init__.json").write_text("{}")

    p1 = mod.PROJECTS_PATH / "p1"
    p1.mkdir()
    (p1 / "config.yaml").write_text("k: v\n")

    assert mod.list_available_projects() == ["a", "p1"]
