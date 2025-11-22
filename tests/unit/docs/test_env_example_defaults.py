from __future__ import annotations

from pathlib import Path


def test_env_example_does_not_contain_production_placeholders() -> None:
    """Guardrail: .env.example must not suggest real staging/prod defaults.

    This test is intended to run in CI to catch accidental introduction of
    real secrets or overly realistic production values.
    """
    path = Path(".env.example")
    if not path.exists():
        # If the example file is removed, this test should be revisited,
        # but do not fail the whole suite.
        return

    content = path.read_text(encoding="utf-8")

    forbidden_markers = [
        "prod-api-key",
        "staging-api-key",
        "prod-kieai",
        "staging-kieai",
        "prod-upload-post",
        "staging-upload-post",
        "prod-hitl-secret",
        "staging-hitl-secret",
    ]

    for marker in forbidden_markers:
        assert marker not in content, f".env.example must not contain production-like value: {marker}"
