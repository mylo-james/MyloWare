from __future__ import annotations

import json

import pytest

from cli import main as cli_main


def test_evidence_command_prints_summary(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    parser = cli_main.build_parser()
    args = parser.parse_args(["evidence", "run-123", "--db-url", "postgresql://cli"])

    class DummyDB:
        def __init__(self, dsn: str) -> None:
            self.dsn = dsn

    monkeypatch.setattr(cli_main, "Database", DummyDB)

    def fake_collect(db, run_id, providers, max_events):  # noqa: ANN001
        return {
            "run": {"run_id": run_id, "status": "published"},
            "artifacts": [],
            "webhookEvents": [],
            "meta": {"providers": providers, "max_events": max_events},
        }

    monkeypatch.setattr(cli_main, "_collect_run_evidence", fake_collect)
    monkeypatch.setattr(cli_main, "_resolve_db_url", lambda explicit: explicit or "postgresql://env")

    code = args.func(args)

    out = capsys.readouterr().out
    assert code == 0
    payload = json.loads(out)
    assert payload["run"]["run_id"] == "run-123"
    assert payload["meta"]["providers"] == ["kieai", "upload-post"]


def test_evidence_command_handles_lookup_errors(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    parser = cli_main.build_parser()
    args = parser.parse_args(["evidence", "missing"])

    class DummyDB:
        def __init__(self, dsn: str) -> None:
            self.dsn = dsn

    monkeypatch.setattr(cli_main, "Database", DummyDB)
    monkeypatch.setattr(cli_main, "_resolve_db_url", lambda explicit: "postgresql://env")

    def fake_collect(*_args, **_kwargs):
        raise LookupError("Run 'missing' not found")

    monkeypatch.setattr(cli_main, "_collect_run_evidence", fake_collect)

    code = args.func(args)
    err = capsys.readouterr().out
    assert code == 1
    assert "Run 'missing' not found" in err
