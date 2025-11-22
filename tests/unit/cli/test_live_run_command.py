from __future__ import annotations

import json
import os
from types import SimpleNamespace

from typing import Any

import httpx
import pytest

from cli import main as cli_main


class LiveRunMockServer:
    def __init__(self, missing_token: bool = False, final_status: str = "published") -> None:
        self.missing_token = missing_token
        self.final_status = final_status
        self.workflow_approved = False
        self.ideate_approved = False
        self.poll_count = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:  # noqa: D401
        path = request.url.path
        if path.endswith("/health"):
            return httpx.Response(200, json={"status": "ok"})
        if path.endswith("/v1/chat/brendan"):
            return httpx.Response(200, json={"run_ids": ["run-live"]})
        if path == "/v1/runs/run-live":
            self.poll_count += 1
            if not self.workflow_approved:
                return httpx.Response(
                    200,
                    json={
                        "run_id": "run-live",
                        "project": "test_video_gen",
                        "status": "pending_workflow",
                        "artifacts": [
                            {"type": "hitl.request", "metadata": {"gate": "workflow"}}
                        ],
                    },
                )
            if not self.ideate_approved:
                return httpx.Response(
                    200,
                    json={
                        "run_id": "run-live",
                        "project": "test_video_gen",
                        "status": "running",
                        "artifacts": [
                            {"type": "hitl.request", "metadata": {"gate": "ideate"}}
                        ],
                    },
                )
            status_payload = {
                "run_id": "run-live",
                "project": "test_video_gen",
                "status": self.final_status,
                "artifacts": [
                    {"provider": "kieai", "type": "kieai.job"},
                    {"provider": "shotstack", "type": "shotstack.timeline"},
                    {"provider": "shotstack", "type": "shotstack.timeline"},
                ],
                "result": {"publishUrls": ["https://videos.example/run-live"]},
            }
            return httpx.Response(200, json=status_payload)
        if "/v1/hitl/link/run-live/" in path:
            gate = path.rsplit("/", 1)[-1]
            payload = {
                "runId": "run-live",
                "gate": gate,
                "approvalUrl": f"https://hitl.example/{gate}?token=token-{gate}",
            }
            if not self.missing_token:
                payload["token"] = f"token-{gate}"
            return httpx.Response(200, json=payload)
        if "/v1/hitl/approve/run-live/" in path:
            gate = path.rsplit("/", 1)[-1]
            if gate == "workflow":
                self.workflow_approved = True
            elif gate == "ideate":
                self.ideate_approved = True
            return httpx.Response(200, json={"runId": "run-live", "gate": gate, "status": "approved"})
        return httpx.Response(404)


def test_live_run_runner_auto_approves_and_returns_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = httpx.MockTransport(LiveRunMockServer())
    runner = cli_main.LiveRunRunner(
        api_base_url="http://api.test",
        api_key="secret",
        project_key="test-video-gen",
        timeout=30,
        poll_interval=0.01,
        transport=transport,
    )
    summary = runner.run()
    assert summary["status"] == "published"
    assert summary["publishUrls"] == ["https://videos.example/run-live"]
    assert "approved workflow gate" in " ".join(summary["activityLog"])
    assert summary["artifactCounts"] == {"kieai": 1, "shotstack": 2}


def test_live_run_runner_parses_token_from_url_when_missing() -> None:
    transport = httpx.MockTransport(LiveRunMockServer(missing_token=True))
    runner = cli_main.LiveRunRunner(
        api_base_url="http://api.test",
        api_key="secret",
        project_key="test-video-gen",
        timeout=30,
        poll_interval=0.01,
        transport=transport,
    )
    summary = runner.run()
    assert summary["publishUrls"]
    assert summary["artifactCounts"]


def test_live_run_runner_times_out_when_not_published() -> None:
    transport = httpx.MockTransport(LiveRunMockServer(final_status="running"))
    runner = cli_main.LiveRunRunner(
        api_base_url="http://api.test",
        api_key="secret",
        project_key="test-video-gen",
        timeout=1,
        poll_interval=0.05,
        transport=transport,
    )
    with pytest.raises(TimeoutError):
        runner.run()


def test_live_run_command_prints_summary(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:

    class DummyRunner(cli_main.LiveRunRunner):
        def __init__(self) -> None:
            pass

        def run(self) -> dict[str, Any]:  # type: ignore[override]
            return {
                "runId": "run-live",
                "project": "test_video_gen",
                "status": "published",
                "publishUrls": ["https://videos.example/run-live"],
                "artifactCount": 4,
                "artifactCounts": {"kieai": 2, "shotstack": 2},
                "approvedGates": ["workflow", "ideate"],
                "activityLog": ["approved workflow gate", "approved ideate gate"],
            }

    dummy_runner = DummyRunner()
    monkeypatch.setenv("API_KEY", "secret")
    monkeypatch.setattr(cli_main, "LiveRunRunner", lambda **kwargs: dummy_runner)

    args = SimpleNamespace(
        project="test-video-gen",
        api_base="http://api.test",
        message=None,
        timeout=30,
        poll_interval=0.5,
        skip_health=False,
        manual_hitl=False,
        env=None,
    )
    code = cli_main._live_run(args)
    assert code == 0
    out = capsys.readouterr().out
    assert "Live run summary" in out
    assert "Primary publish URL" in out
    assert "Artifact counts" in out


def test_live_run_parser_accepts_no_auto_hitl_flag() -> None:
    parser = cli_main.build_parser()
    args = parser.parse_args([
        "live-run",
        "test-video-gen",
        "--no-auto-hitl",
        "--api-base",
        "http://api.example",
        "--timeout",
        "30",
        "--poll-interval",
        "0.5",
        "--skip-health",
    ])

    assert getattr(args, "manual_hitl", False) is True
