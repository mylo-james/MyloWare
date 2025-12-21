from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import sys
from types import SimpleNamespace
from uuid import uuid4

from click.testing import CliRunner

from myloware.cli import dev as dev_cli
from myloware.storage.models import ArtifactType


def test_dev_check_env_handles_missing_dotenv_and_prints_optional(monkeypatch, tmp_path) -> None:
    # Run in an isolated directory that contains a .env file.
    (tmp_path / ".env").write_text("IGNORED=1\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    # Simulate python-dotenv not being installed so we hit the ImportError pass.
    real_import = __import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):  # type: ignore[no-untyped-def]
        if name == "dotenv":
            raise ImportError("no dotenv")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr("builtins.__import__", fake_import)

    # Ensure required env vars are present.
    monkeypatch.setenv("USE_LANGGRAPH_ENGINE", "true")
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("API_KEY", "test")
    monkeypatch.setenv("WEBHOOK_BASE_URL", "http://localhost")

    printed: list[str] = []
    monkeypatch.setattr(
        dev_cli.console,
        "print",
        lambda *args, **_kw: printed.append(" ".join(str(a) for a in args)),
    )

    result = CliRunner().invoke(dev_cli.dev, ["check-env"])
    assert result.exit_code == 0
    assert any("Optional env vars not set" in m for m in printed)


def test_dev_check_env_loads_dotenv_when_available(monkeypatch, tmp_path) -> None:
    (tmp_path / ".env").write_text("IGNORED=1\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    called: list[object] = []

    def fake_load_dotenv(path):  # type: ignore[no-untyped-def]
        called.append(path)

    monkeypatch.setitem(sys.modules, "dotenv", SimpleNamespace(load_dotenv=fake_load_dotenv))

    monkeypatch.setenv("USE_LANGGRAPH_ENGINE", "true")
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("API_KEY", "test")
    monkeypatch.setenv("WEBHOOK_BASE_URL", "http://localhost")

    monkeypatch.setattr(dev_cli.console, "print", lambda *_a, **_kw: None)

    result = CliRunner().invoke(dev_cli.dev, ["check-env"])
    assert result.exit_code == 0
    assert called


def test_dev_check_env_exits_nonzero_when_required_missing(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    for key in ("USE_LANGGRAPH_ENGINE", "DATABASE_URL", "API_KEY", "WEBHOOK_BASE_URL"):
        monkeypatch.delenv(key, raising=False)

    result = CliRunner().invoke(dev_cli.dev, ["check-env"])
    assert result.exit_code == 1
    assert "Missing required env vars" in result.output


@dataclass
class _FakeArtifact:
    artifact_type: str
    id: str = "art-1"
    created_at: datetime = datetime.now(timezone.utc)
    content: str | None = None


class _FakeArtifactRepo:
    def __init__(self, _session, artifacts: list[_FakeArtifact]):  # type: ignore[no-untyped-def]
        self._artifacts = artifacts

    def get_by_run(self, _run_id):  # type: ignore[no-untyped-def]
        return list(self._artifacts)


@contextmanager
def _fake_session_cm():
    yield object()


def test_dev_test_agent_extracts_job_id_from_quoted_json(monkeypatch) -> None:
    run_id = str(uuid4())
    artifacts = [
        _FakeArtifact(
            artifact_type=ArtifactType.EDITOR_OUTPUT.value,
            content='some text... "job_id": "job-123" ... end',
        )
    ]

    monkeypatch.setattr(dev_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(
        dev_cli,
        "ArtifactRepository",
        lambda session: _FakeArtifactRepo(session, artifacts),
    )

    printed: list[str] = []
    monkeypatch.setattr(
        dev_cli.console,
        "print",
        lambda *args, **_kw: printed.append(" ".join(str(a) for a in args)),
    )

    result = CliRunner().invoke(dev_cli.dev, ["test-agent", run_id])
    assert result.exit_code == 0
    assert any("Extracted job_id" in m for m in printed)


def test_dev_test_agent_rejects_invalid_run_id() -> None:
    result = CliRunner().invoke(dev_cli.dev, ["test-agent", "not-a-uuid"])
    assert result.exit_code == 1
    assert "Invalid run_id" in result.output


def test_dev_test_agent_prints_when_no_editor_output(monkeypatch) -> None:
    run_id = str(uuid4())
    artifacts = [
        _FakeArtifact(
            artifact_type=ArtifactType.IDEAS.value,
            content="idea",
        )
    ]

    monkeypatch.setattr(dev_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(
        dev_cli,
        "ArtifactRepository",
        lambda session: _FakeArtifactRepo(session, artifacts),
    )

    result = CliRunner().invoke(dev_cli.dev, ["test-agent", run_id])
    assert result.exit_code == 0
    assert "No editor output artifacts found" in result.output


def test_dev_test_agent_continues_on_bad_json_then_finds_job_id(monkeypatch) -> None:
    run_id = str(uuid4())
    artifacts = [
        _FakeArtifact(
            artifact_type=ArtifactType.EDITOR_OUTPUT.value,
            content=(
                "## Tool Results\n"
                "remotion_render\n"
                "```json\n"
                "{not valid json}\n"
                "```\n"
                'later: "job_id": "job-456"\n'
            ),
        )
    ]

    monkeypatch.setattr(dev_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(
        dev_cli,
        "ArtifactRepository",
        lambda session: _FakeArtifactRepo(session, artifacts),
    )

    result = CliRunner().invoke(dev_cli.dev, ["test-agent", run_id])
    assert result.exit_code == 0


def test_dev_test_agent_extracts_job_id_from_tool_result_json(monkeypatch) -> None:
    run_id = str(uuid4())
    artifacts = [
        _FakeArtifact(
            artifact_type=ArtifactType.EDITOR_OUTPUT.value,
            content=(
                "## Tool Results\n"
                "remotion_render\n"
                "```json\n"
                '{"job_id": "job-789"}\n'
                "```\n"
            ),
        )
    ]

    monkeypatch.setattr(dev_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(
        dev_cli,
        "ArtifactRepository",
        lambda session: _FakeArtifactRepo(session, artifacts),
    )

    result = CliRunner().invoke(dev_cli.dev, ["test-agent", run_id])
    assert result.exit_code == 0
    assert "Extracted job_id" in result.output


def test_dev_test_agent_prints_when_job_id_missing(monkeypatch) -> None:
    run_id = str(uuid4())
    artifacts = [
        _FakeArtifact(
            artifact_type=ArtifactType.EDITOR_OUTPUT.value,
            content="no tools here",
        )
    ]

    monkeypatch.setattr(dev_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(
        dev_cli,
        "ArtifactRepository",
        lambda session: _FakeArtifactRepo(session, artifacts),
    )

    printed: list[str] = []
    monkeypatch.setattr(
        dev_cli.console,
        "print",
        lambda *args, **_kw: printed.append(" ".join(str(a) for a in args)),
    )

    result = CliRunner().invoke(dev_cli.dev, ["test-agent", run_id])
    assert result.exit_code == 0
    assert any("No job_id found" in m for m in printed)


def test_dev_test_agent_treats_blank_job_id_as_missing(monkeypatch) -> None:
    run_id = str(uuid4())
    artifacts = [
        _FakeArtifact(
            artifact_type=ArtifactType.EDITOR_OUTPUT.value,
            content='... "job_id": "   " ...',
        )
    ]

    monkeypatch.setattr(dev_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(
        dev_cli,
        "ArtifactRepository",
        lambda session: _FakeArtifactRepo(session, artifacts),
    )

    result = CliRunner().invoke(dev_cli.dev, ["test-agent", run_id])
    assert result.exit_code == 0
    assert "No job_id found" in result.output


def test_dev_e2e_includes_base_url(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_run(cmd, cwd, check):  # type: ignore[no-untyped-def]
        seen["cmd"] = cmd
        return type("R", (), {"returncode": 0})()

    monkeypatch.setattr("subprocess.run", fake_run)

    result = CliRunner().invoke(
        dev_cli.dev,
        [
            "e2e",
            "--base-url",
            "http://example.test",
            "--api-key",
            "k",
            "--workflow",
            "w",
            "--brief",
            "b",
        ],
    )
    assert result.exit_code == 0
    assert "--base-url" in seen["cmd"]
    assert "http://example.test" in seen["cmd"]
