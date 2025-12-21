"""Worker CLI commands."""

from __future__ import annotations

import anyio
import click


@click.group()
def worker() -> None:
    """Worker processes (Postgres job queue)."""


@worker.command("run")
@click.option("--once", is_flag=True, help="Process at most one job and exit")
def worker_run(once: bool) -> None:
    """Run a worker loop that claims jobs from Postgres."""
    from myloware.workers import run_worker

    async def _run() -> None:
        await run_worker(once=once)

    try:
        anyio.run(_run)
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc


def register(cli: click.Group) -> None:
    cli.add_command(worker)
