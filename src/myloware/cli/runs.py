"""Runs CLI commands."""

from __future__ import annotations

import builtins
import time
from typing import Any
from uuid import UUID

import anyio
import click
from rich.panel import Panel
from rich.table import Table

from myloware.llama_clients import get_sync_client
from myloware.storage.database import get_session
from myloware.storage.models import ArtifactType, RunStatus
from myloware.storage.repositories import ArtifactRepository, RunRepository
from myloware.cli.ui import console, format_status, render_runs_table


@click.group()
def runs() -> None:
    """Manage workflow runs."""


@runs.command()
@click.option("--limit", default=10, show_default=True, type=int)
def list(limit: int) -> None:
    """List recent runs."""
    with get_session() as session:
        repo = RunRepository(session)
        recent_runs = repo.list(limit=limit)
    render_runs_table(recent_runs)


@runs.command()
@click.argument("run_id")
@click.option(
    "--interval",
    default=2.0,
    show_default=True,
    type=float,
    help="Poll interval in seconds",
)
def watch(run_id: str, interval: float) -> None:
    """Watch a run until it reaches a terminal status."""
    with get_session() as session:
        repo = RunRepository(session)
        last_status: str | None = None

        while True:
            run = repo.get_by_id_str(run_id)
            if run is None:
                raise click.ClickException(f"Run {run_id} not found")

            status = getattr(run, "status", "")
            if status != last_status:
                console.print(f"[bold]Status[/bold] {format_status(status)}")
                last_status = status

            if status in {RunStatus.COMPLETED.value, RunStatus.FAILED.value}:
                console.print(f"Run {run_id} finished with {format_status(status)}")
                break

            if hasattr(session, "expire_all"):
                session.expire_all()

            time.sleep(interval)


@runs.command()
@click.argument("run_id")
@click.option(
    "--action",
    default="auto",
    type=click.Choice(
        [
            "auto",
            "videos",
            "render",
            "publish",
            "repair-render",
            "repair-videos",
            "fork-from-clips",
        ],
        case_sensitive=False,
    ),
    help="Resume action to perform (default: auto).",
)
@click.option(
    "--approve-publish",
    is_flag=True,
    help="Approve the publish gate if the run is awaiting publish approval",
)
@click.option("--force", is_flag=True, help="Allow resume even if run status is not replayable")
@click.option(
    "--checkpoint-id",
    default=None,
    help="Optional checkpoint_id for fork-from-clips",
)
@click.option(
    "--video-index",
    "video_indexes",
    multiple=True,
    type=int,
    help="Optional 0-based index to repair when action=repair-videos (repeatable).",
)
@click.option("--yes", is_flag=True, help="Skip confirmation prompt")
def resume(
    run_id: str,
    action: str,
    approve_publish: bool,
    force: bool,
    checkpoint_id: str | None,
    video_indexes: tuple[int, ...],
    yes: bool,
) -> None:
    """Manually resume a stuck LangGraph workflow."""
    from myloware.workflows.langgraph.workflow import resume_run

    try:
        run_uuid = UUID(run_id)
    except ValueError:
        raise click.ClickException(f"Invalid run_id: {run_id} (must be a UUID)")

    if not yes and not click.confirm(f"Resume workflow for run {run_id}?"):
        console.print("[yellow]Cancelled[/yellow]")
        return

    console.print(f"[bold]Resuming LangGraph workflow for run: {run_id}[/bold]")

    async def _run() -> dict[str, Any]:
        return await resume_run(
            run_uuid,
            action=action,
            approve_publish=approve_publish,
            force=force,
            checkpoint_id=checkpoint_id,
            video_indexes=builtins.list(video_indexes) if video_indexes else None,
        )

    try:
        outcome = anyio.run(_run)
        message = outcome.get("message") or "Resume requested"
        action_taken = outcome.get("action") or action
        console.print(f"[green]✅ {message}[/green] (action={action_taken})")
    except Exception as exc:
        raise click.ClickException(f"Failed to resume workflow: {exc}") from exc


@runs.command()
@click.argument("run_id")
@click.option(
    "--interval", default=3.0, show_default=True, type=float, help="Poll interval in seconds"
)
@click.option(
    "--max-duration",
    default=600.0,
    show_default=True,
    type=float,
    help="Max monitoring duration in seconds",
)
def monitor(run_id: str, interval: float, max_duration: float) -> None:
    """Monitor a run with telemetry integration."""
    from myloware.observability.telemetry import query_run_traces

    console.print(f"\n[bold]👀 Monitoring run {run_id}[/bold]")
    console.print("   Using built-in observability (telemetry + database)")
    console.print(f"   Polling every {interval}s, max {max_duration}s")

    client = get_sync_client()
    start_time = time.time()
    traces_seen: set[str] = set()
    last_status: str | None = None
    telemetry_enabled = True

    async def _monitor() -> None:
        nonlocal last_status, telemetry_enabled
        consecutive_same_status = 0
        max_same_status = 10

        while True:
            elapsed = time.time() - start_time
            if elapsed > max_duration:
                console.print(f"\n[yellow]⏱️  Max duration ({max_duration}s) exceeded[/yellow]")
                break

            with get_session() as session:
                repo = RunRepository(session)
                run = repo.get_by_id_str(run_id)
                if run is None:
                    raise click.ClickException(f"Run {run_id} not found")

                status = getattr(run, "status", "")
                current_step = getattr(run, "current_step", "")

                if status != last_status:
                    consecutive_same_status = 0
                    console.print(f"\n[bold]Status:[/bold] {format_status(status)}")
                    if current_step:
                        console.print(f"   Step: {current_step}")
                else:
                    consecutive_same_status += 1

                if telemetry_enabled:
                    try:
                        response = query_run_traces(client, run_id, limit=100)
                        traces = getattr(response, "traces", None) or []
                        new_traces = [
                            t
                            for t in traces
                            if getattr(t, "trace_id", None)
                            and getattr(t, "trace_id") not in traces_seen
                        ]
                        if new_traces:
                            console.print(f"   🔍 New traces: {len(new_traces)}")
                            traces_seen.update(getattr(t, "trace_id") for t in new_traces)
                    except Exception:
                        telemetry_enabled = False

                if status in {RunStatus.COMPLETED.value, RunStatus.FAILED.value}:
                    console.print(f"\n[green]✅ Run finished: {format_status(status)}[/green]")
                    break

                if consecutive_same_status >= max_same_status:
                    console.print(
                        f"\n[yellow]⚠️  Status unchanged for {max_same_status} polls[/yellow]"
                    )
                    break

                last_status = status

            await anyio.sleep(interval)

    try:
        anyio.run(_monitor)
    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Monitoring interrupted by user[/yellow]")
    except Exception as exc:
        raise click.ClickException(f"Monitoring failed: {exc}") from exc


@runs.command()
@click.argument("run_id")
def artifacts(run_id: str) -> None:
    """Show artifacts for a run (producer/editor output, etc.)."""
    try:
        run_uuid = UUID(run_id)
    except ValueError:
        raise click.ClickException(f"Invalid run_id: {run_id} (must be a UUID)")

    with get_session() as session:
        repo = ArtifactRepository(session)
        artifacts_list = repo.get_by_run(run_uuid)

        if not artifacts_list:
            console.print(f"[yellow]No artifacts found for run {run_id}[/yellow]")
            return

        table = Table(title=f"Artifacts for Run {run_id}", show_lines=False)
        table.add_column("Type", style="cyan")
        table.add_column("Persona", style="white")
        table.add_column("Size", style="dim")
        table.add_column("URI", style="dim")

        for art in artifacts_list:
            size = f"{len(art.content)} chars" if art.content else "-"
            uri = art.uri or "-"
            table.add_row(art.artifact_type, art.persona or "-", size, uri)

        console.print(table)

        for art in artifacts_list:
            if art.artifact_type == ArtifactType.PRODUCER_OUTPUT.value and art.content:
                console.print("\n[bold]Producer Output:[/bold]")
                console.print(Panel(art.content[:2000], border_style="cyan"))
                if len(art.content) > 2000:
                    console.print(f"[dim]... (truncated, total {len(art.content)} chars)[/dim]")
            elif art.artifact_type == ArtifactType.EDITOR_OUTPUT.value and art.content:
                console.print("\n[bold]Editor Output:[/bold]")
                console.print(Panel(art.content[:2000], border_style="cyan"))
                if len(art.content) > 2000:
                    console.print(f"[dim]... (truncated, total {len(art.content)} chars)[/dim]")


@runs.command()
@click.argument("run_id")
@click.option(
    "--limit", default=50, show_default=True, type=int, help="Number of log entries to show"
)
def logs(run_id: str, limit: int) -> None:
    """Tail structured logs for a run via telemetry."""
    from myloware.observability.telemetry import query_run_traces

    client = get_sync_client()
    console.print(f"[bold]Fetching logs for run {run_id}...[/bold]")

    try:
        response = query_run_traces(client, run_id, limit=limit)
        if not hasattr(response, "traces") or not response.traces:
            console.print("[yellow]No traces found for this run[/yellow]")
            console.print("[dim]Telemetry may not be available or run has no traces yet[/dim]")
            return

        console.print(f"\n[bold]Found {len(response.traces)} traces[/bold]\n")

        for trace in response.traces[:limit]:
            trace_id = getattr(trace, "trace_id", None) or getattr(trace, "id", None)
            name = getattr(trace, "name", "unknown")
            start_time = getattr(trace, "start_time", None)
            status = getattr(trace, "status", "unknown")

            status_icon = "✓" if status == "OK" else "✗" if status == "ERROR" else "○"
            short_id = trace_id[:16] if isinstance(trace_id, str) else "unknown"
            console.print(f"{status_icon} {name} ({short_id}...)")
            if start_time:
                console.print(f"   Time: {start_time}")

    except Exception as exc:
        console.print(f"[yellow]Failed to fetch logs: {exc}[/yellow]")
        console.print("[dim]Telemetry may not be available[/dim]")


def register(cli: click.Group) -> None:
    cli.add_command(runs)
