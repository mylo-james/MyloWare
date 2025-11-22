from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from cli import main as cli_main


def _make_summary(run_id: str, project: str = "test_video_gen") -> dict[str, Any]:
    return {
        "runId": run_id,
        "project": project,
        "status": "published",
        "publishUrls": [f"https://videos.example/{run_id}"],
        "artifactCount": 4,
        "artifactCounts": {"kieai": 2, "shotstack": 2},
        "approvedGates": ["workflow"],
        "activityLog": ["approved workflow gate"],
    }


def test_demo_command_runs_and_prints_summary(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    class DummyRunner:
        def __init__(self, **kwargs):  # noqa: ANN001
            self.kwargs = kwargs

        def run(self) -> dict[str, Any]:  # type: ignore[override]
            return _make_summary("demo-run")

    dummy_runner = DummyRunner()
    monkeypatch.setenv("API_KEY", "demo")
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")
    created_kwargs: dict[str, Any] = {}

    def _runner_factory(**kwargs):  # noqa: ANN001
        created_kwargs.update(kwargs)
        return dummy_runner

    monkeypatch.setattr(cli_main, "LiveRunRunner", _runner_factory)

    exit_code = cli_main.main(["demo", "test-video-gen"])

    assert exit_code == 0
    assert created_kwargs["project_key"] == "test-video-gen"
    out = capsys.readouterr().out
    assert "demo-run" in out
    assert "test_video_gen" in out
    assert "Primary publish URL" in out


def test_demo_requires_api_key(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")
    exit_code = cli_main.main(["demo", "aismr"])
    assert exit_code == 2
    assert "API_KEY is required" in capsys.readouterr().out


def test_demo_command_supports_aismr(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    class DummyRunner:
        def __init__(self, project_key: str, **_):  # noqa: ANN001
            self.project_key = project_key

        def run(self) -> dict[str, Any]:  # type: ignore[override]
            return _make_summary(f"demo-{self.project_key}", project="aismr")

    monkeypatch.setenv("API_KEY", "demo")
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")

    def _runner_factory(**kwargs):  # noqa: ANN001
        return DummyRunner(**kwargs)

    monkeypatch.setattr(cli_main, "LiveRunRunner", _runner_factory)

    exit_code = cli_main.main(["demo", "aismr"])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "demo-aismr" in out
