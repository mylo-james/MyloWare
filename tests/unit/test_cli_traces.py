from __future__ import annotations

from types import SimpleNamespace

from click.testing import CliRunner

from myloware.cli import traces as traces_cli


def test_traces_watch_converts_trace_dict(monkeypatch) -> None:
    class TraceWithDict:
        trace_id = "t1"

        def dict(self):  # type: ignore[no-untyped-def]
            return {"trace_id": "t1", "name": "n", "status": "OK", "start_time": "now"}

    class FakeTelemetry:
        def query_traces(self, limit: int):  # type: ignore[no-untyped-def]
            return SimpleNamespace(traces=[TraceWithDict()])

    fake_client = SimpleNamespace(telemetry=FakeTelemetry(), _base_url="http://x")

    monkeypatch.setattr(traces_cli, "get_sync_client", lambda: fake_client)
    monkeypatch.setattr(traces_cli.console, "print", lambda *_a, **_kw: None)

    def stop_sleep(_interval: int) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(traces_cli.time, "sleep", stop_sleep)

    result = CliRunner().invoke(traces_cli.traces, ["watch", "--interval", "0"])
    assert result.exit_code == 0


def test_traces_watch_converts_trace_model_dump(monkeypatch) -> None:
    class TraceWithModelDump:
        trace_id = "t1"

        def model_dump(self):  # type: ignore[no-untyped-def]
            return {"trace_id": "t1", "name": "n", "status": "OK", "start_time": "now"}

    class FakeTelemetry:
        def query_traces(self, limit: int):  # type: ignore[no-untyped-def]
            return SimpleNamespace(traces=[TraceWithModelDump()])

    fake_client = SimpleNamespace(telemetry=FakeTelemetry(), _base_url="http://x")

    monkeypatch.setattr(traces_cli, "get_sync_client", lambda: fake_client)
    monkeypatch.setattr(traces_cli.console, "print", lambda *_a, **_kw: None)

    def stop_sleep(_interval: int) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(traces_cli.time, "sleep", stop_sleep)

    result = CliRunner().invoke(traces_cli.traces, ["watch", "--interval", "0"])
    assert result.exit_code == 0


def test_traces_watch_raises_click_exception_on_outer_failure(monkeypatch) -> None:
    class FakeTelemetry:
        def query_traces(self, limit: int):  # type: ignore[no-untyped-def]
            raise RuntimeError("boom")

    fake_client = SimpleNamespace(telemetry=FakeTelemetry(), _base_url="http://x")

    monkeypatch.setattr(traces_cli, "get_sync_client", lambda: fake_client)
    monkeypatch.setattr(traces_cli.console, "print", lambda *_a, **_kw: None)

    def explode_sleep(_interval: int) -> None:
        raise RuntimeError("sleep boom")

    monkeypatch.setattr(traces_cli.time, "sleep", explode_sleep)

    result = CliRunner().invoke(traces_cli.traces, ["watch", "--interval", "0"])
    assert result.exit_code == 1
    assert "Failed to watch traces" in result.output
