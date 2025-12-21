"""Unit tests for KB CLI commands."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

from click.testing import CliRunner


def test_kb_setup_verbose_prints_connection(monkeypatch) -> None:
    from myloware.cli.kb import kb

    print_mock = Mock()
    monkeypatch.setattr("myloware.cli.kb.console.print", print_mock)

    fake_client = SimpleNamespace(_base_url="http://example.test")
    monkeypatch.setattr("myloware.cli.kb.get_sync_client", lambda: fake_client)

    monkeypatch.setattr(
        "myloware.knowledge.loader.load_documents_with_manifest",
        lambda *_a, **_kw: ([], {"hash": "h"}),
    )
    monkeypatch.setattr(
        "myloware.knowledge.setup.setup_project_knowledge",
        lambda **_kw: "vs-1",
    )

    result = CliRunner().invoke(kb, ["setup", "--verbose"])
    assert result.exit_code == 0

    print_mock.assert_any_call("[dim]Verbose mode enabled[/dim]")
    assert any(
        "Connected to: http://example.test" in str(call.args[0]) for call in print_mock.mock_calls
    )


def test_kb_validate_runs_script_and_exits(monkeypatch) -> None:
    from myloware.cli.kb import kb

    calls: list[dict[str, object]] = []

    def fake_run(cmd, cwd, check):  # type: ignore[no-untyped-def]
        calls.append({"cmd": cmd, "cwd": cwd, "check": check})
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("myloware.cli.kb.subprocess.run", fake_run)

    result = CliRunner().invoke(kb, ["validate", "--vector-store-id", "vs-123"])
    assert result.exit_code == 0

    assert calls
    assert calls[0]["cwd"] == "."
    assert calls[0]["check"] is False
    cmd = calls[0]["cmd"]
    assert isinstance(cmd, list)
    assert "scripts/validate_kb.py" in cmd
    assert "--vector-store-id" in cmd
    assert "vs-123" in cmd
