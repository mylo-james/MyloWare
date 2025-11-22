from __future__ import annotations

import httpx
import pytest

from cli import main as cli_main


class RunWatchMockServer:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:  # noqa: D401
        if request.url.path == "/v1/runs/run-watch" and request.method == "GET":
            self.calls += 1
            if self.calls == 1:
                return httpx.Response(
                    200,
                    json={
                        "runId": "run-watch",
                        "project": "test_video_gen",
                        "status": "pending",
                        "artifacts": [],
                    },
                )
            if self.calls == 2:
                return httpx.Response(
                    200,
                    json={
                        "runId": "run-watch",
                        "project": "test_video_gen",
                        "status": "running",
                        "result": {"awaiting_gate": "ideate"},
                        "artifacts": [
                            {
                                "type": "hitl.request",
                                "provider": "orchestrator",
                                "metadata": {"gate": "ideate"},
                            }
                        ],
                    },
                )
            return httpx.Response(
                200,
                json={
                    "runId": "run-watch",
                    "project": "test_video_gen",
                    "status": "published",
                    "result": {"publishUrls": ["https://videos.example/run-watch"]},
                    "artifacts": [
                        {
                            "type": "hitl.request",
                            "provider": "orchestrator",
                            "metadata": {"gate": "ideate"},
                        }
                    ],
                },
            )
        return httpx.Response(404)


def test_run_watcher_streams_status(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    transport = httpx.MockTransport(RunWatchMockServer())
    monkeypatch.setattr(cli_main.time, "sleep", lambda *_args, **_kwargs: None)
    watcher = cli_main.RunWatcher(
        api_base_url="http://api.test",
        api_key="secret",
        run_id="run-watch",
        poll_interval=0.01,
        timeout=5,
        langsmith_project="myloware-dev",
        transport=transport,
    )
    code = watcher.watch()
    out = capsys.readouterr().out
    assert code == 0
    assert "status -> pending" in out
    assert "awaiting HITL gate 'ideate'" in out
    assert "Publish URLs" in out


def test_watch_command_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = cli_main.build_parser()
    args = parser.parse_args(["runs", "watch", "run-missing"])
    monkeypatch.delenv("API_KEY", raising=False)
    assert args.func(args) == 2


def test_watch_command_invokes_watcher(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = cli_main.build_parser()
    args = parser.parse_args([
        "runs",
        "watch",
        "run-cli",
        "--api-base",
        "http://api.mock",
        "--poll-interval",
        "0.5",
        "--timeout",
        "60",
        "--langsmith-project",
        "cli-project",
    ])

    monkeypatch.setenv("API_KEY", "secret")
    monkeypatch.setenv("LANGSMITH_PROJECT", "env-project")

    events: dict[str, object] = {}

    class DummyWatcher:
        def __init__(self, **kwargs: object) -> None:
            events.update(kwargs)

        def watch(self) -> int:
            events["called"] = True
            return 0

    monkeypatch.setattr(cli_main, "RunWatcher", lambda **kwargs: DummyWatcher(**kwargs))

    assert args.func(args) == 0
    assert events.get("called") is True
    assert events.get("api_base_url") == "http://api.mock"
    assert events.get("langsmith_project") == "cli-project"
