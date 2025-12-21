from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

from click.testing import CliRunner

from myloware.cli import runs as runs_cli
from myloware.storage.models import ArtifactType, RunStatus


@contextmanager
def _fake_session_cm():
    class _Session:
        def expire_all(self) -> None:
            return None

    yield _Session()


def test_runs_watch_raises_when_run_missing(monkeypatch) -> None:
    class FakeRunRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_id_str(self, _run_id: str):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli, "RunRepository", FakeRunRepo)

    result = CliRunner().invoke(runs_cli.runs, ["watch", "missing", "--interval", "0"])
    assert result.exit_code == 1
    assert "not found" in result.output.lower()


def test_runs_watch_completes(monkeypatch) -> None:
    statuses = iter([RunStatus.RUNNING.value, RunStatus.COMPLETED.value])

    class FakeRunRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_id_str(self, _run_id: str):  # type: ignore[no-untyped-def]
            return SimpleNamespace(status=next(statuses))

    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli, "RunRepository", FakeRunRepo)
    monkeypatch.setattr(runs_cli.time, "sleep", lambda _t: None)

    result = CliRunner().invoke(runs_cli.runs, ["watch", str(uuid4()), "--interval", "0"])
    assert result.exit_code == 0
    assert "finished" in result.output.lower()


def test_runs_resume_wraps_anyio_errors(monkeypatch) -> None:
    def fake_anyio_run(*_a, **_kw):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr(runs_cli.anyio, "run", fake_anyio_run)

    result = CliRunner().invoke(runs_cli.runs, ["resume", str(uuid4()), "--yes"])
    assert result.exit_code == 1
    assert "Failed to resume workflow" in result.output


def test_runs_resume_invalid_run_id() -> None:
    result = CliRunner().invoke(runs_cli.runs, ["resume", "not-a-uuid"])
    assert result.exit_code == 1
    assert "Invalid run_id" in result.output


def test_runs_resume_cancelled(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli.click, "confirm", lambda *_a, **_k: False)
    result = CliRunner().invoke(runs_cli.runs, ["resume", str(uuid4())])
    assert result.exit_code == 0
    assert "Cancelled" in result.output


def test_runs_resume_action_passes_checkpoint_id(monkeypatch) -> None:
    seen: dict[str, object] = {}

    async def fake_resume_run(*_a, **_k):  # type: ignore[no-untyped-def]
        seen.update(_k)
        return {"action": _k.get("action"), "message": "ok", "result": object()}

    monkeypatch.setattr("myloware.workflows.langgraph.workflow.resume_run", fake_resume_run)
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_k: None)

    run_id = str(uuid4())
    result = CliRunner().invoke(
        runs_cli.runs,
        ["resume", run_id, "--action", "fork-from-clips", "--checkpoint-id", "cp-1", "--yes"],
    )
    assert result.exit_code == 0
    assert seen.get("action") == "fork-from-clips"
    assert seen.get("checkpoint_id") == "cp-1"


def test_runs_resume_action_passes_video_indexes(monkeypatch) -> None:
    seen: dict[str, object] = {}

    async def fake_resume_run(*_a, **_k):  # type: ignore[no-untyped-def]
        seen.update(_k)
        return {"action": _k.get("action"), "message": "ok", "result": object()}

    monkeypatch.setattr("myloware.workflows.langgraph.workflow.resume_run", fake_resume_run)
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_k: None)

    run_id = str(uuid4())
    result = CliRunner().invoke(
        runs_cli.runs,
        [
            "resume",
            run_id,
            "--action",
            "repair-videos",
            "--video-index",
            "1",
            "--video-index",
            "3",
            "--yes",
        ],
    )
    assert result.exit_code == 0
    assert seen.get("action") == "repair-videos"
    assert seen.get("video_indexes") == [1, 3]


def test_runs_monitor_exits_on_max_duration(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    times = iter([0.0, 1.0])
    monkeypatch.setattr(runs_cli.time, "time", lambda: next(times))

    result = CliRunner().invoke(
        runs_cli.runs,
        ["monitor", "run", "--interval", "0", "--max-duration", "0"],
    )
    assert result.exit_code == 0


def test_runs_monitor_wraps_errors(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)
    monkeypatch.setattr(runs_cli.time, "time", lambda: 0.0)

    class FakeRunRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_id_str(self, _run_id: str):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli, "RunRepository", FakeRunRepo)

    result = CliRunner().invoke(
        runs_cli.runs,
        ["monitor", "run", "--interval", "0", "--max-duration", "999"],
    )
    assert result.exit_code == 1
    assert "Monitoring failed" in result.output


def test_runs_monitor_increments_consecutive_status(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    # Make time advance so we get two iterations before exceeding max_duration.
    times = iter([0.0, 0.0, 0.1, 1.0])
    monkeypatch.setattr(runs_cli.time, "time", lambda: next(times))

    async def fake_sleep(_interval: float) -> None:
        return None

    monkeypatch.setattr(runs_cli.anyio, "sleep", fake_sleep)

    def fake_query_run_traces(*_a, **_kw):  # type: ignore[no-untyped-def]
        return SimpleNamespace(traces=[])

    monkeypatch.setattr("myloware.observability.telemetry.query_run_traces", fake_query_run_traces)

    class FakeRunRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_id_str(self, _run_id: str):  # type: ignore[no-untyped-def]
            return SimpleNamespace(status=RunStatus.RUNNING.value, current_step="")

    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli, "RunRepository", FakeRunRepo)

    result = CliRunner().invoke(
        runs_cli.runs,
        ["monitor", "run", "--interval", "0", "--max-duration", "0.15"],
    )
    assert result.exit_code == 0


def test_runs_monitor_breaks_on_unchanged_status(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)
    monkeypatch.setattr(runs_cli.time, "time", lambda: 0.0)

    async def fake_sleep(_interval: float) -> None:
        return None

    monkeypatch.setattr(runs_cli.anyio, "sleep", fake_sleep)

    def fake_query_run_traces(*_a, **_kw):  # type: ignore[no-untyped-def]
        raise RuntimeError("disable telemetry")

    monkeypatch.setattr("myloware.observability.telemetry.query_run_traces", fake_query_run_traces)

    class FakeRunRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_id_str(self, _run_id: str):  # type: ignore[no-untyped-def]
            return SimpleNamespace(status=RunStatus.RUNNING.value, current_step="")

    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli, "RunRepository", FakeRunRepo)

    result = CliRunner().invoke(
        runs_cli.runs,
        ["monitor", "run", "--interval", "0", "--max-duration", "999"],
    )
    assert result.exit_code == 0


def test_runs_artifacts_invalid_id(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)
    result = CliRunner().invoke(runs_cli.runs, ["artifacts", "not-a-uuid"])
    assert result.exit_code == 1
    assert "Invalid run_id" in result.output


def test_runs_artifacts_empty_and_truncation(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    class FakeArtifactRepoEmpty:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_run(self, _run_uuid):  # type: ignore[no-untyped-def]
            return []

    monkeypatch.setattr(runs_cli, "ArtifactRepository", FakeArtifactRepoEmpty)
    result = CliRunner().invoke(runs_cli.runs, ["artifacts", str(uuid4())])
    assert result.exit_code == 0

    class FakeArtifactRepoTrunc:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_run(self, _run_uuid):  # type: ignore[no-untyped-def]
            return [
                SimpleNamespace(
                    artifact_type=ArtifactType.EDITOR_OUTPUT.value,
                    persona="editor",
                    content="x" * 2001,
                    uri=None,
                )
            ]

    monkeypatch.setattr(runs_cli, "ArtifactRepository", FakeArtifactRepoTrunc)
    result = CliRunner().invoke(runs_cli.runs, ["artifacts", str(uuid4())])
    assert result.exit_code == 0


def test_runs_logs_prints_on_telemetry_errors(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())

    def fake_query_run_traces(*_a, **_kw):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr("myloware.observability.telemetry.query_run_traces", fake_query_run_traces)

    result = CliRunner().invoke(runs_cli.runs, ["logs", "run", "--limit", "1"])
    assert result.exit_code == 0
    assert "Failed to fetch logs" in result.output


def test_runs_resume_success(monkeypatch) -> None:
    async def fake_resume_run(*_a, **_k):  # type: ignore[no-untyped-def]
        return {"action": "auto", "message": "ok", "result": object()}

    monkeypatch.setattr("myloware.workflows.langgraph.workflow.resume_run", fake_resume_run)
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_k: None)
    result = CliRunner().invoke(runs_cli.runs, ["resume", str(uuid4()), "--yes"])
    assert result.exit_code == 0


def test_runs_monitor_prints_new_traces(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    times = iter([0.0, 0.0, 0.1, 1.0])
    monkeypatch.setattr(runs_cli.time, "time", lambda: next(times))

    async def fake_sleep(_interval: float) -> None:
        return None

    monkeypatch.setattr(runs_cli.anyio, "sleep", fake_sleep)

    trace = SimpleNamespace(trace_id="trace-1")
    monkeypatch.setattr(
        "myloware.observability.telemetry.query_run_traces",
        lambda *_a, **_kw: SimpleNamespace(traces=[trace]),
    )

    class FakeRunRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_id_str(self, _run_id: str):  # type: ignore[no-untyped-def]
            return SimpleNamespace(status=RunStatus.COMPLETED.value, current_step="final")

    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli, "RunRepository", FakeRunRepo)

    result = CliRunner().invoke(
        runs_cli.runs,
        ["monitor", "run", "--interval", "0", "--max-duration", "1"],
    )
    assert result.exit_code == 0


def test_runs_monitor_keyboard_interrupt(monkeypatch) -> None:
    monkeypatch.setattr(
        runs_cli.anyio, "run", lambda *_a, **_k: (_ for _ in ()).throw(KeyboardInterrupt())
    )
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_k: None)
    result = CliRunner().invoke(
        runs_cli.runs, ["monitor", "run", "--interval", "0", "--max-duration", "1"]
    )
    assert result.exit_code == 0


def test_runs_artifacts_editor_output_truncates(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    class FakeArtifactRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_run(self, _run_uuid):  # type: ignore[no-untyped-def]
            return [
                SimpleNamespace(
                    artifact_type=ArtifactType.EDITOR_OUTPUT.value,
                    persona="editor",
                    content="y" * 2001,
                    uri=None,
                )
            ]

    monkeypatch.setattr(runs_cli, "ArtifactRepository", FakeArtifactRepo)
    result = CliRunner().invoke(runs_cli.runs, ["artifacts", str(uuid4())])
    assert result.exit_code == 0


def test_runs_artifacts_producer_output_truncates(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_session", lambda: _fake_session_cm())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    class FakeArtifactRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        def get_by_run(self, _run_uuid):  # type: ignore[no-untyped-def]
            return [
                SimpleNamespace(
                    artifact_type=ArtifactType.PRODUCER_OUTPUT.value,
                    persona="producer",
                    content="p" * 2001,
                    uri=None,
                )
            ]

    monkeypatch.setattr(runs_cli, "ArtifactRepository", FakeArtifactRepo)
    result = CliRunner().invoke(runs_cli.runs, ["artifacts", str(uuid4())])
    assert result.exit_code == 0


def test_runs_logs_no_traces(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    def fake_query_run_traces(*_a, **_kw):  # type: ignore[no-untyped-def]
        return SimpleNamespace(traces=[])

    monkeypatch.setattr("myloware.observability.telemetry.query_run_traces", fake_query_run_traces)

    result = CliRunner().invoke(runs_cli.runs, ["logs", "run", "--limit", "1"])
    assert result.exit_code == 0


def test_runs_logs_with_traces(monkeypatch) -> None:
    monkeypatch.setattr(runs_cli, "get_sync_client", lambda: object())
    monkeypatch.setattr(runs_cli.console, "print", lambda *_a, **_kw: None)

    traces = [
        SimpleNamespace(trace_id="trace-1", name="step", start_time="now", status="OK"),
    ]

    monkeypatch.setattr(
        "myloware.observability.telemetry.query_run_traces",
        lambda *_a, **_kw: SimpleNamespace(traces=traces),
    )

    result = CliRunner().invoke(runs_cli.runs, ["logs", "run", "--limit", "1"])
    assert result.exit_code == 0
