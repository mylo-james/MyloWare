"""Unit tests for prompt building with guardrails and persona guidance."""
from __future__ import annotations

from collections.abc import Mapping

import pytest

from apps.api.services.test_video_gen import _build_video_prompt


def test_build_video_prompt_respects_guardrails_no_overlay() -> None:
    """Verify that guardrails prevent overlay text from being added."""
    project_spec: Mapping[str, object] = {
        "guardrails": {
            "onscreen_text_policy": "Non-diegetic on-screen text must be added via Shotstack overlays; do not bake into Veo renders.",
        },
    }
    
    prompt = _build_video_prompt(
        base_prompt="Test prompt",
        video={"subject": "moon", "header": "cheeseburger"},
        project_spec=project_spec,
        persona_guidance=None,
    )
    
    assert "Overlay the header text" not in prompt
    assert "cheeseburger" not in prompt
    assert "moon" in prompt
    assert "Test prompt" in prompt


def test_build_video_prompt_allows_overlay_when_no_guardrail() -> None:
    """Verify legacy behavior when guardrails don't forbid overlays."""
    project_spec: Mapping[str, object] = {
        "guardrails": {},
    }
    
    prompt = _build_video_prompt(
        base_prompt="Test prompt",
        video={"subject": "moon", "header": "cheeseburger"},
        project_spec=project_spec,
        persona_guidance=None,
    )
    
    # Should include overlay instruction when guardrail doesn't forbid it
    assert "Overlay the header text 'cheeseburger'" in prompt or "cheeseburger" in prompt


def test_build_video_prompt_includes_persona_guidance() -> None:
    """Verify persona guidance is prepended when provided."""
    persona_guidance = "You are Veo, the video generation specialist."
    
    prompt = _build_video_prompt(
        base_prompt="Test prompt",
        video={"subject": "moon"},
        project_spec=None,
        persona_guidance=persona_guidance,
    )
    
    assert persona_guidance in prompt
    assert prompt.startswith(persona_guidance)


def test_build_video_prompt_handles_missing_guardrails() -> None:
    """Verify prompt building works when project_spec is None."""
    prompt = _build_video_prompt(
        base_prompt="Test prompt",
        video={"subject": "moon", "header": "cheeseburger"},
        project_spec=None,
        persona_guidance=None,
    )
    
    assert "moon" in prompt
    assert "Test prompt" in prompt


def test_build_video_prompt_handles_empty_video() -> None:
    """Verify prompt building works with minimal video spec."""
    prompt = _build_video_prompt(
        base_prompt="Test prompt",
        video={},
        project_spec=None,
        persona_guidance=None,
    )
    
    assert "Test prompt" in prompt
    assert prompt.strip() == "Test prompt"

