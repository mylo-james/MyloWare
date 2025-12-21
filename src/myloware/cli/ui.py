"""Shared CLI UI helpers (Rich formatting)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from rich.console import Console
from rich.table import Table

from myloware.storage.models import RunStatus

console = Console()


def format_status(status: str) -> str:
    """Return colorized status string for terminal output."""
    colors = {
        RunStatus.PENDING.value: "grey62",
        RunStatus.RUNNING.value: "cyan",
        RunStatus.AWAITING_IDEATION_APPROVAL.value: "yellow",
        RunStatus.AWAITING_VIDEO_GENERATION.value: "yellow",
        RunStatus.AWAITING_RENDER.value: "yellow",
        RunStatus.AWAITING_PUBLISH.value: "yellow",
        RunStatus.AWAITING_PUBLISH_APPROVAL.value: "yellow",
        RunStatus.COMPLETED.value: "green",
        RunStatus.REJECTED.value: "red",
        RunStatus.FAILED.value: "red",
    }
    color = colors.get(status, "white")
    return f"[{color}]{status}[/{color}]"


def render_runs_table(runs: Iterable[Any]) -> None:
    """Render a table of runs using Rich."""
    table = Table(title="Recent Runs", show_lines=False)
    table.add_column("Run ID", style="white")
    table.add_column("Workflow", style="cyan")
    table.add_column("Status", style="bold")
    table.add_column("Step", style="magenta")
    table.add_column("Created", style="white")

    for run in runs:
        created = getattr(run, "created_at", None)
        created_str = (
            created.isoformat(timespec="seconds") if isinstance(created, datetime) else "-"
        )
        table.add_row(
            str(getattr(run, "id", "")),
            getattr(run, "workflow_name", ""),
            format_status(getattr(run, "status", "")),
            getattr(run, "current_step", "") or "-",
            created_str,
        )

    console.print(table)
