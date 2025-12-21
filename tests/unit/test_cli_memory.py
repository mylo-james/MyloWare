"""Unit tests for memory bank CLI commands."""

from __future__ import annotations

import click
from click.testing import CliRunner


def test_memory_setup_registers_bank(monkeypatch) -> None:
    from myloware.cli.memory import memory

    called: dict[str, object] = {}

    def fake_register_memory_bank(client, name):  # type: ignore[no-untyped-def]
        called["client"] = client
        called["name"] = name

    monkeypatch.setattr("myloware.cli.memory.get_sync_client", lambda: "client")
    monkeypatch.setattr("myloware.memory.banks.register_memory_bank", fake_register_memory_bank)
    monkeypatch.setattr("myloware.cli.memory.console.print", lambda *_a, **_k: None)

    result = CliRunner().invoke(memory, ["setup"])
    assert result.exit_code == 0
    assert called["name"] == "user-preferences"


def test_memory_clear_invokes_clear_user_memory(monkeypatch) -> None:
    from myloware.cli.memory import memory

    called: dict[str, object] = {}

    def fake_clear_user_memory(client, user_id):  # type: ignore[no-untyped-def]
        called["client"] = client
        called["user_id"] = user_id

    monkeypatch.setattr("myloware.cli.memory.get_sync_client", lambda: "client")
    monkeypatch.setattr("myloware.memory.banks.clear_user_memory", fake_clear_user_memory)
    monkeypatch.setattr("myloware.cli.memory.console.print", lambda *_a, **_k: None)

    result = CliRunner().invoke(memory, ["clear", "u1"])
    assert result.exit_code == 0
    assert called["user_id"] == "u1"


def test_memory_register_adds_command() -> None:
    from myloware.cli.memory import register

    cli = click.Group()
    register(cli)
    assert "memory" in cli.commands
