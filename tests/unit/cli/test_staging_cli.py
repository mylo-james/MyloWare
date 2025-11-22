from __future__ import annotations

from types import SimpleNamespace

import pytest

from cli import main as cli_main


class DummyProcess:
    def __init__(self, returncode=0, stdout="", stderr=""):  # noqa: ANN001
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_staging_deploy_invokes_flyctl(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {}

    def fake_run(cmd, cwd=None, capture_output=False, text=False):  # noqa: ANN001
        called["cmd"] = cmd
        called["cwd"] = cwd
        return DummyProcess()

    monkeypatch.setattr(cli_main.subprocess, "run", fake_run)
    args = SimpleNamespace(component="orchestrator", strategy="immediate")
    assert cli_main._staging_deploy(args) == 0
    assert called["cmd"][:3] == ["flyctl", "deploy", "-c"]
    assert "fly.orchestrator.toml" in called["cmd"]


def test_staging_logs_filters_output(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    output = "good line\nbad line\nanother good\n"

    def fake_run(cmd, cwd=None, capture_output=False, text=False):  # noqa: ANN001
        assert capture_output is True
        assert text is True
        return DummyProcess(stdout=output)

    monkeypatch.setattr(cli_main.subprocess, "run", fake_run)
    args = SimpleNamespace(component="orchestrator", lines=50, filter="good", tail=0)
    assert cli_main._staging_logs(args) == 0
    printed = capsys.readouterr().out.strip().splitlines()
    assert printed == ["good line", "another good"]


def test_staging_run_start_posts_payload(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    class DummyResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):  # noqa: D401
            return None

        def json(self):
            return self.payload

    called = {}

    def fake_post(url, headers=None, json=None, timeout=None):  # noqa: ANN001
        called["url"] = url
        called["json"] = json
        return DummyResponse({"runId": "run-staging"})

    monkeypatch.setenv("STAGING_API_KEY", "stage-key")
    monkeypatch.setattr(cli_main.httpx, "post", fake_post)
    args = SimpleNamespace(
        project="test-video-gen",
        input='{"prompt": "Hello"}',
        prompt="unused",
        api_key=None,
        api_base=None,
        env="staging",
    )
    assert cli_main._staging_run_start(args) == 0
    assert "run-staging" in capsys.readouterr().out
    assert called["json"]["project"] == "test_video_gen"


def test_staging_run_status_prints_summary(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    class DummyResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    def fake_get(url, headers=None, timeout=None):  # noqa: ANN001
        payload = {
            "run_id": "run-status",
            "project": "test_video_gen",
            "status": "running",
            "artifacts": [
                {"metadata": {"persona": "iggy"}},
                {"metadata": {"persona": "riley"}},
            ],
        }
        return DummyResponse(payload)

    monkeypatch.setenv("STAGING_API_KEY", "stage-key")
    monkeypatch.setattr(cli_main.httpx, "get", fake_get)
    args = SimpleNamespace(run_id="run-status", api_key=None, api_base=None, env="staging")
    assert cli_main._staging_run_status(args) == 0
    out = capsys.readouterr().out
    assert "run-status" in out
    assert "iggy" in out and "riley" in out
