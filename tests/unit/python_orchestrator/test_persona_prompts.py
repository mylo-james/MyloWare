from __future__ import annotations

from typing import Mapping

import pytest

from apps.orchestrator import persona_prompts


@pytest.fixture
def persona_dir(tmp_path, monkeypatch: pytest.MonkeyPatch):
    base = tmp_path / "data" / "personas"
    base.mkdir(parents=True)
    monkeypatch.setattr(persona_prompts, "_PERSONA_DIR_CANDIDATES", [base])
    return base


def test_load_persona_prompt_prefers_markdown(persona_dir) -> None:
    persona_path = persona_dir / "iggy"
    persona_path.mkdir(parents=True)
    (persona_path / "prompt.md").write_text("Markdown prompt", encoding="utf-8")
    (persona_path / "persona.json").write_text('{"systemPrompt": "json"}', encoding="utf-8")

    prompt = persona_prompts.load_persona_prompt("iggy")

    assert prompt == "Markdown prompt"


def test_load_persona_prompt_falls_back_to_json(persona_dir) -> None:
    persona_path = persona_dir / "alex"
    persona_path.mkdir(parents=True)
    (persona_path / "persona.json").write_text(
        '{"systemPrompt": "Timeline lead", "description": "fallback"}',
        encoding="utf-8",
    )

    prompt = persona_prompts.load_persona_prompt("alex")

    assert prompt == "Timeline lead"


def test_compose_system_prompt_includes_tools_and_materials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(persona_prompts, "load_persona_prompt", lambda _: "Base persona prompt")
    context: Mapping[str, object] = {
        "allowed_tools": ["memory_search", "render_video_timeline_tool"],
        "instructions": "Render the stitched template.",
        "materials": {"input": "Generate final edit", "videos": [{"index": 0}, {"index": 1}]},
        "project_spec": {"specs": {"videoDuration": 8}},
        "constraints": {"guardrails": {"summary": "Keep overlays minimal."}},
    }

    prompt = persona_prompts.compose_system_prompt("alex", context)

    assert "Base persona prompt" in prompt
    assert "render_video_timeline_tool" in prompt
    assert "User brief" in prompt and "Clips referenced: 2" in prompt
    assert "Project specs" in prompt and "videoDuration" in prompt
    assert "Guardrails summary" in prompt


def test_build_persona_user_message_includes_allowed_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(persona_prompts, "load_persona_prompt", lambda _: "Prompt")
    context = {
        "run_id": "run-123",
        "project": "test_video_gen",
        "allowed_tools": ["memory_search", "submit_generation_jobs_tool"],
        "videos": [{"index": 0, "subject": "moon"}],
    }
    state = {"input": "Make two clips", "videos": [{"index": 0, "subject": "moon"}]}

    message = persona_prompts.build_persona_user_message("riley", context, state)

    assert "Run ID: run-123" in message
    assert "test_video_gen" in message
    assert "Make two clips" in message
    assert "Allowed LangChain tools" in message
