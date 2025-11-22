from __future__ import annotations

from core.runs import identifiers


def test_project_prefix_normalizes_values() -> None:
    assert identifiers.project_prefix(None) == "RUN"
    assert identifiers.project_prefix("test_video_gen") == "TVG"
    assert identifiers.project_prefix("AI SMR") == "AS"


def test_generate_job_code_uses_prefix_and_random_characters(monkeypatch) -> None:
    sequence = iter(["A", "B", "C", "1", "2", "3"])
    monkeypatch.setattr(identifiers.random, "choice", lambda seq: next(sequence))
    code = identifiers.generate_job_code("test_video_gen")
    assert code == "TVGABC123"
