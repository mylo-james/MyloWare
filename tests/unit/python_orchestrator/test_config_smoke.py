from __future__ import annotations

import json
from pathlib import Path

import pytest

from apps.orchestrator.config import Settings
from apps.orchestrator import config_smoke


def _write_expectations(path: Path, personas: dict[str, dict[str, object]]) -> None:
    path.write_text(json.dumps(personas, indent=2), encoding="utf-8")


def test_run_config_smoke_checks_happy_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """run_config_smoke_checks should pass for well-formed project configs."""

    projects_dir = tmp_path / "projects"
    projects_dir.mkdir()
    project_dir = projects_dir / "demo"
    project_dir.mkdir()

    expectations = {
        "iggy": {"tools": ["memory_search"]},
        "riley": {"tools": ["memory_search", "submit_generation_jobs_tool"]},
        "alex": {"tools": ["render_video_timeline_tool"]},
        "quinn": {"tools": ["memory_search", "publish_to_tiktok_tool"]},
    }
    _write_expectations(project_dir / "agent-expectations.json", expectations)

    # Point the smoke checks at our temporary projects directory and stub
    # adapter host validation (covered in separate tests).
    monkeypatch.setattr(config_smoke.persona_context, "_PROJECTS_DIR", projects_dir, raising=False)
    monkeypatch.setattr(config_smoke, "validate_adapter_hosts", lambda _settings: None, raising=False)

    settings = Settings(environment="local")
    config_smoke.run_config_smoke_checks(settings)


def test_run_config_smoke_checks_raises_on_missing_persona(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing required personas must cause config smoke checks to fail."""

    projects_dir = tmp_path / "projects"
    projects_dir.mkdir()
    project_dir = projects_dir / "demo"
    project_dir.mkdir()

    # Deliberately omit Quinn to trigger a failure.
    expectations = {
        "iggy": {"tools": ["memory_search"]},
        "riley": {"tools": ["memory_search", "submit_generation_jobs_tool"]},
        "alex": {"tools": ["render_video_timeline_tool"]},
    }
    _write_expectations(project_dir / "agent-expectations.json", expectations)

    monkeypatch.setattr(config_smoke.persona_context, "_PROJECTS_DIR", projects_dir, raising=False)
    monkeypatch.setattr(config_smoke, "validate_adapter_hosts", lambda _settings: None, raising=False)

    settings = Settings(environment="local")
    cache_clear = getattr(config_smoke.persona_context._load_agent_expectations, "cache_clear", None)  # type: ignore[attr-defined]
    if cache_clear is not None:
        cache_clear()
    with pytest.raises(RuntimeError) as exc:
        config_smoke.run_config_smoke_checks(settings)
    message = str(exc.value)
    assert "missing personas" in message
