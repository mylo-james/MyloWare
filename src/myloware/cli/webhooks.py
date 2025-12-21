"""Webhook CLI utilities (DLQ replay, etc.)."""

from __future__ import annotations

from uuid import UUID

import anyio
import click

from myloware.cli.ui import console
from myloware.storage.database import get_async_session_factory
from myloware.storage.repositories import DeadLetterRepository


@click.group()
def webhooks() -> None:
    """Webhook utilities (DLQ replay, etc.)."""


@webhooks.command("replay")
@click.argument("dead_letter_id")
def webhooks_replay(dead_letter_id: str) -> None:
    """Replay a dead-lettered webhook by ID."""
    from myloware.workflows.dlq_replay import replay_dead_letter

    async def _run() -> dict:
        SessionLocal = get_async_session_factory()
        async with SessionLocal() as session:
            repo = DeadLetterRepository(session)
            dl = await repo.get_async(UUID(dead_letter_id))
            if not dl:
                raise click.ClickException(f"Dead letter {dead_letter_id} not found")
            await repo.increment_attempts_async(dl.id)
            try:
                result = await replay_dead_letter(dl)
            except Exception as exc:
                raise click.ClickException(str(exc)) from exc
            await repo.mark_resolved_async(dl.id)
            await session.commit()
            return result

    result = anyio.run(_run)
    console.print_json(data=result)


def register(cli: click.Group) -> None:
    cli.add_command(webhooks)
