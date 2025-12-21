"""Unit tests for worker CLI commands."""

from __future__ import annotations

import click
from click.testing import CliRunner


def test_worker_run_invokes_run_worker_once(monkeypatch) -> None:
    from myloware.cli.worker import worker

    called: dict[str, object] = {}

    async def fake_run_worker(*, once: bool) -> None:
        called["once"] = once

    monkeypatch.setattr("myloware.workers.run_worker", fake_run_worker)

    result = CliRunner().invoke(worker, ["run", "--once"])
    assert result.exit_code == 0
    assert called["once"] is True


def test_worker_run_wraps_exceptions_as_click_exception(monkeypatch) -> None:
    from myloware.cli.worker import worker

    async def boom(*, once: bool) -> None:  # noqa: ARG001 - signature match
        raise RuntimeError("boom")

    monkeypatch.setattr("myloware.workers.run_worker", boom)

    result = CliRunner().invoke(worker, ["run", "--once"])
    assert result.exit_code != 0
    assert "boom" in result.output


def test_worker_register_adds_command() -> None:
    from myloware.cli.worker import register

    cli = click.Group()
    register(cli)
    assert "worker" in cli.commands
