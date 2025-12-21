"""Unit tests for webhook CLI utilities."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

from click.testing import CliRunner

from myloware.cli.main import cli


def _patch_anyio_run(monkeypatch) -> None:
    def fake_anyio_run(func, *args, **kwargs):
        return asyncio.run(func(*args, **kwargs))

    monkeypatch.setattr("myloware.cli.webhooks.anyio.run", fake_anyio_run)


def test_webhooks_replay_success(monkeypatch) -> None:
    dl_id = uuid4()
    dl = SimpleNamespace(id=dl_id)

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def get_async(self, _dl_id):
            return dl

        async def increment_attempts_async(self, _dl_id):
            return None

        async def mark_resolved_async(self, _dl_id):
            return None

    @asynccontextmanager
    async def fake_session_cm():
        async def commit():
            return None

        yield SimpleNamespace(commit=commit)

    monkeypatch.setattr("myloware.cli.webhooks.DeadLetterRepository", FakeRepo)
    monkeypatch.setattr(
        "myloware.cli.webhooks.get_async_session_factory", lambda: lambda: fake_session_cm()
    )

    async def replay_dead_letter(_dl):
        return {"ok": True}

    monkeypatch.setattr("myloware.workflows.dlq_replay.replay_dead_letter", replay_dead_letter)
    _patch_anyio_run(monkeypatch)

    result = CliRunner().invoke(cli, ["webhooks", "replay", str(dl_id)])
    assert result.exit_code == 0
    assert '"ok": true' in result.output


def test_webhooks_replay_missing_dead_letter(monkeypatch) -> None:
    dl_id = uuid4()

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def get_async(self, _dl_id):
            return None

        async def increment_attempts_async(self, _dl_id):
            return None

        async def mark_resolved_async(self, _dl_id):
            return None

    @asynccontextmanager
    async def fake_session_cm():
        async def commit():
            return None

        yield SimpleNamespace(commit=commit)

    monkeypatch.setattr("myloware.cli.webhooks.DeadLetterRepository", FakeRepo)
    monkeypatch.setattr(
        "myloware.cli.webhooks.get_async_session_factory", lambda: lambda: fake_session_cm()
    )
    _patch_anyio_run(monkeypatch)

    result = CliRunner().invoke(cli, ["webhooks", "replay", str(dl_id)])
    assert result.exit_code != 0
    assert "not found" in result.output


def test_webhooks_replay_propagates_error(monkeypatch) -> None:
    dl_id = uuid4()
    dl = SimpleNamespace(id=dl_id)

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def get_async(self, _dl_id):
            return dl

        async def increment_attempts_async(self, _dl_id):
            return None

        async def mark_resolved_async(self, _dl_id):
            return None

    @asynccontextmanager
    async def fake_session_cm():
        async def commit():
            return None

        yield SimpleNamespace(commit=commit)

    async def fail(_dl):
        raise RuntimeError("boom")

    monkeypatch.setattr("myloware.cli.webhooks.DeadLetterRepository", FakeRepo)
    monkeypatch.setattr(
        "myloware.cli.webhooks.get_async_session_factory", lambda: lambda: fake_session_cm()
    )
    monkeypatch.setattr("myloware.workflows.dlq_replay.replay_dead_letter", fail)
    _patch_anyio_run(monkeypatch)

    result = CliRunner().invoke(cli, ["webhooks", "replay", str(dl_id)])
    assert result.exit_code != 0
    assert "boom" in result.output
