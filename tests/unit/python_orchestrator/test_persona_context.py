from __future__ import annotations

from typing import Any

import pytest

from apps.orchestrator.graph_factory import load_project_spec
from apps.orchestrator import persona_context
from apps.orchestrator.persona_context import build_persona_context
from apps.orchestrator.run_state import RunState


def test_persona_context_returns_minimal_fields() -> None:
    project_spec = load_project_spec("test_video_gen")
    state: RunState = RunState(
        run_id="run-context-1",
        project="test_video_gen",
        input="Make a moon + sun video",
        videos=[{"index": 0, "status": "pending"}],
        clips=[{"index": 0, "status": "pending"}],
    )

    context = build_persona_context(state, project_spec, "iggy")

    assert set(context.keys()) == {
        "system_prompt",
        "run_id",
        "project",
        "videos",
        "clips",
        "allowed_tools",
        "project_spec",
        "run_input",
        "options",
        "materials",
    }
    assert context["run_id"] == "run-context-1"
    assert context["project"] == "test_video_gen"
    assert context["videos"] == state["videos"]
    assert context["clips"] == state["clips"]
    assert context["allowed_tools"] == ["memory_search"]
    assert context["run_input"] == "Make a moon + sun video"
    assert context["options"] == {}
    assert context["materials"]["input"] == "Make a moon + sun video"


def test_persona_context_embeds_run_input_and_project_spec() -> None:
    project_spec = load_project_spec("test_video_gen")
    state: RunState = RunState(run_id="ctx-2", project="test_video_gen", input="Need a mock clip")

    context = build_persona_context(state, project_spec, "iggy")

    prompt = context["system_prompt"]
    assert "Need a mock clip" in prompt
    assert "Project spec" in prompt
    assert "test_video_gen" in prompt


def test_persona_context_handles_missing_optional_fields(monkeypatch: Any) -> None:
    project_spec: dict[str, Any] = {}
    state: RunState = RunState(run_id="ctx-3", project="aismr", input="start")

    context = build_persona_context(state, project_spec, "iggy")

    assert context["videos"] == []
    assert context["clips"] == []
    assert context["allowed_tools"] == ["memory_search", "transfer_to_riley"]
    prompt = context["system_prompt"]
    assert "Run input:" in prompt
    assert prompt.strip().endswith("start")


def test_persona_context_requires_project_name() -> None:
    project_spec: dict[str, Any] = {}
    state: RunState = RunState(run_id="ctx-4", project="", input="hello")

    with pytest.raises(RuntimeError):
        build_persona_context(state, project_spec, "iggy")


def test_persona_context_uses_project_spec_name_when_state_missing_project() -> None:
    project_spec = load_project_spec("test_video_gen")
    state: RunState = RunState(run_id="ctx-5", project="", input="Need scripts")

    context = build_persona_context(state, project_spec, "riley")

    assert context["project"] == "test_video_gen"
    assert context["allowed_tools"] == [
        "memory_search",
        "submit_generation_jobs_tool",
        "wait_for_generations_tool",
    ]


def test_persona_context_uses_project_spec_slug_when_no_project_in_state() -> None:
    project_spec = {"slug": "aismr"}
    state: RunState = RunState(run_id="ctx-6", project="", input="Need modifiers")

    context = build_persona_context(state, project_spec, "iggy")

    assert context["project"] == "aismr"
    assert context["allowed_tools"] == ["memory_search", "transfer_to_riley"]


def test_build_system_prompt_handles_unserializable_spec() -> None:
    prompt = persona_context._build_system_prompt("iggy", {"spec": {1, 2}}, {"input": "hello"})
    assert "Run input" in prompt
    assert "{'spec': {1, 2}}" in prompt


@pytest.fixture
def persona_dirs(tmp_path, monkeypatch: pytest.MonkeyPatch):
    personas = tmp_path / "personas"
    projects = tmp_path / "projects"
    personas.mkdir()
    projects.mkdir()
    monkeypatch.setattr(persona_context, "_PERSONAS_DIR", personas)
    monkeypatch.setattr(persona_context, "_PROJECTS_DIR", projects)
    persona_context._load_persona_profile.cache_clear()
    persona_context._load_agent_expectations.cache_clear()
    yield personas, projects
    persona_context._load_persona_profile.cache_clear()
    persona_context._load_agent_expectations.cache_clear()


def test_load_agent_expectations_requires_file(persona_dirs) -> None:
    _, _ = persona_dirs
    with pytest.raises(FileNotFoundError):
        persona_context._load_agent_expectations("ghost")


def test_load_agent_expectations_rejects_empty_project_name() -> None:
    persona_context._load_agent_expectations.cache_clear()
    with pytest.raises(ValueError):
        persona_context._load_agent_expectations("")


def test_load_agent_expectations_validates_json(persona_dirs) -> None:
    _, projects = persona_dirs
    project_dir = projects / "demo"
    project_dir.mkdir()
    (project_dir / "agent-expectations.json").write_text("[]", encoding="utf-8")
    with pytest.raises(RuntimeError):
        persona_context._load_agent_expectations("demo")


def test_load_allowed_tools_validates_persona_entries(persona_dirs) -> None:
    _, projects = persona_dirs
    project_dir = projects / "demo"
    project_dir.mkdir()
    (project_dir / "agent-expectations.json").write_text(
        '{"iggy": {"tools": []}, "alex": {"tools": "memory_search"}}',
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        persona_context._load_allowed_tools("demo", "iggy")
    with pytest.raises(TypeError):
        persona_context._load_allowed_tools("demo", "alex")


def test_load_allowed_tools_requires_known_persona(persona_dirs) -> None:
    _, projects = persona_dirs
    project_dir = projects / "demo"
    project_dir.mkdir()
    (project_dir / "agent-expectations.json").write_text(
        '{"iggy": {"tools": ["memory_search"]}}',
        encoding="utf-8",
    )
    with pytest.raises(KeyError):
        persona_context._load_allowed_tools("demo", "alex")


def test_load_allowed_tools_requires_mapping_config(persona_dirs) -> None:
    _, projects = persona_dirs
    project_dir = projects / "demo"
    project_dir.mkdir()
    (project_dir / "agent-expectations.json").write_text(
        '{"iggy": ["memory_search"]}',
        encoding="utf-8",
    )
    with pytest.raises(TypeError):
        persona_context._load_allowed_tools("demo", "iggy")


@pytest.mark.parametrize(
    ("project", "persona", "expected_tools"),
    [
        ("test_video_gen", "iggy", ["memory_search"]),
        (
            "test_video_gen",
            "riley",
            ["memory_search", "submit_generation_jobs_tool", "wait_for_generations_tool"],
        ),
        ("test_video_gen", "alex", ["memory_search", "render_video_timeline_tool"]),
        ("test_video_gen", "quinn", ["memory_search", "publish_to_tiktok_tool"]),
        ("aismr", "iggy", ["memory_search", "transfer_to_riley"]),
        (
            "aismr",
            "riley",
            ["memory_search", "submit_generation_jobs_tool", "wait_for_generations_tool", "transfer_to_alex"],
        ),
        (
            "aismr",
            "alex",
            ["memory_search", "render_video_timeline_tool", "transfer_to_quinn"],
        ),
        ("aismr", "quinn", ["memory_search", "publish_to_tiktok_tool"]),
    ],
)
def test_load_allowed_tools_matches_real_project_configs(project: str, persona: str, expected_tools: list[str]) -> None:
    persona_context._load_agent_expectations.cache_clear()
    assert persona_context._load_allowed_tools(project, persona) == expected_tools
