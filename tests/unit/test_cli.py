"""Unit tests for CLI commands."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from importlib.metadata import version
from types import SimpleNamespace
from uuid import uuid4

from click.testing import CliRunner

from cli.main import cli
from workflows.orchestrator import RunStatus, WorkflowResult


def test_version_command():
    """myloware --version shows package version."""

    result = CliRunner().invoke(cli, ["--version"])

    assert result.exit_code == 0
    assert version("myloware") in result.output


def test_runs_list(monkeypatch):
    """runs list prints recent runs in table form."""

    runs = [
        SimpleNamespace(
            id="run-1",
            workflow_name="aismr",
            status=RunStatus.RUNNING.value,
            current_step="ideator",
            created_at=datetime(2025, 12, 5, 12, 0, 0),
        )
    ]

    class FakeRunRepo:
        def __init__(self, _session):
            pass

        def list(self, limit: int = 10, offset: int = 0, status=None):
            assert limit == 5
            return runs

    @contextmanager
    def fake_session():
        yield SimpleNamespace(expire_all=lambda: None)

    monkeypatch.setattr("cli.main.RunRepository", FakeRunRepo)
    monkeypatch.setattr("cli.main.get_session", fake_session)

    result = CliRunner().invoke(cli, ["runs", "list", "--limit", "5"])

    assert result.exit_code == 0
    assert "aismr" in result.output
    assert RunStatus.RUNNING.value in result.output


def test_runs_watch(monkeypatch):
    """runs watch polls until terminal status."""

    statuses = [
        RunStatus.RUNNING.value,
        RunStatus.AWAITING_IDEATION_APPROVAL.value,
        RunStatus.COMPLETED.value,
    ]

    class FakeRunRepo:
        def __init__(self, _session):
            self.calls = 0

        def get_by_id_str(self, run_id: str):
            status = statuses[min(self.calls, len(statuses) - 1)]
            self.calls += 1
            return SimpleNamespace(id=run_id, status=status, current_step=None)

    @contextmanager
    def fake_session():
        yield SimpleNamespace(expire_all=lambda: None)

    monkeypatch.setattr("cli.main.RunRepository", FakeRunRepo)
    monkeypatch.setattr("cli.main.get_session", fake_session)
    monkeypatch.setattr("cli.main.time.sleep", lambda _s: None)

    result = CliRunner().invoke(cli, ["runs", "watch", "abc", "--interval", "0"])

    assert result.exit_code == 0
    assert RunStatus.COMPLETED.value in result.output
    assert "finished" in result.output


def test_demo_aismr_interactive(monkeypatch):
    """demo aismr runs workflow and approvals."""

    run_id = uuid4()
    calls = {"start": 0, "ideation": 0, "publish": 0}

    def fake_run_workflow(client, brief, vector_db_id, run_repo, artifact_repo, workflow_name):
        calls["start"] += 1
        assert brief == "demo brief"
        return WorkflowResult(
            run_id=run_id,
            status=RunStatus.AWAITING_IDEATION_APPROVAL,
            current_step="ideator",
            artifacts={"ideas": "idea list"},
        )

    def fake_approve_gate(*, gate, **_kwargs):
        if gate == "ideation":
            calls["ideation"] += 1
            return WorkflowResult(
                run_id=run_id,
                status=RunStatus.AWAITING_PUBLISH_APPROVAL,
                current_step="editor",
                artifacts={"editor": "render plan"},
            )

        calls["publish"] += 1
        return WorkflowResult(
            run_id=run_id,
            status=RunStatus.COMPLETED,
            current_step="publisher",
            artifacts={"published": "url"},
        )

    class FakeRunRepo:
        def __init__(self, _session):
            pass

    class FakeArtifactRepo:
        def __init__(self, _session):
            pass

    @contextmanager
    def fake_session():
        yield SimpleNamespace(expire_all=lambda: None)

    monkeypatch.setattr("cli.main.RunRepository", FakeRunRepo)
    monkeypatch.setattr("cli.main.ArtifactRepository", FakeArtifactRepo)
    monkeypatch.setattr("cli.main.get_session", fake_session)
    monkeypatch.setattr("cli.main.get_client", lambda: object())
    monkeypatch.setattr("cli.main.run_workflow", fake_run_workflow)
    monkeypatch.setattr("cli.main.approve_gate", fake_approve_gate)

    # Inputs: brief prompt, then two confirmations (enter=Yes)
    result = CliRunner().invoke(cli, ["demo", "aismr"], input="demo brief\n\n\n")

    assert result.exit_code == 0
    assert calls["start"] == 1
    assert calls["ideation"] == 1
    assert calls["publish"] == 1
    assert RunStatus.COMPLETED.value in result.output
