"""MyloWare command-line interface."""

from __future__ import annotations

import time
from datetime import datetime
from importlib.metadata import version
from typing import Iterable

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from client import get_client
from config import settings
from storage.database import get_session
from storage.repositories import ArtifactRepository, RunRepository
from workflows.hitl import GATE_IDEATION, GATE_PUBLISH, approve_gate
from workflows.orchestrator import RunStatus, run_workflow

console = Console()


def _vector_db_id() -> str:
    """Return configured vector DB identifier (default: project_kb)."""
    return getattr(settings, "vector_db_id", "project_kb")


def _get_project_vector_db(project: str) -> str:
    """Return vector DB ID for a project."""
    return f"{project}-knowledge"


def _format_status(status: str) -> str:
    """Return colorized status string for terminal output."""

    colors = {
        RunStatus.PENDING.value: "grey62",
        RunStatus.RUNNING.value: "cyan",
        RunStatus.AWAITING_IDEATION_APPROVAL.value: "yellow",
        RunStatus.AWAITING_PUBLISH_APPROVAL.value: "yellow",
        RunStatus.COMPLETED.value: "green",
        RunStatus.FAILED.value: "red",
    }
    color = colors.get(status, "white")
    return f"[{color}]{status}[/{color}]"


def _render_runs_table(runs: Iterable) -> None:
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
            _format_status(getattr(run, "status", "")),
            getattr(run, "current_step", "") or "-",
            created_str,
        )

    console.print(table)


@click.group()
@click.version_option(version=version("myloware"), prog_name="myloware")
def cli():
    """MyloWare - Llama Stack multi-agent video production."""
    pass


@cli.group()
def demo():
    """Run interactive demos."""
    pass


@demo.command()
@click.argument("brief", required=False)
@click.option("--vector-db-id", help="Vector DB to use", default=None)
def aismr(brief: str | None, vector_db_id: str | None):
    """Run AISMR workflow interactively with HITL approvals."""
    if not brief:
        brief = click.prompt("Enter video brief")

    vdb = vector_db_id or _get_project_vector_db("aismr")
    console.print("[bold blue]Starting AISMR workflow...[/bold blue]")

    client = get_client()
    with get_session() as session:
        run_repo = RunRepository(session)
        artifact_repo = ArtifactRepository(session)

        result = run_workflow(
            client=client,
            brief=brief,
            vector_db_id=vdb,
            run_repo=run_repo,
            artifact_repo=artifact_repo,
            workflow_name="aismr",
        )

        # Display ideator output
        if result.artifacts.get("ideas"):
            console.print(
                Panel(result.artifacts["ideas"], title="Ideator: Ideas", border_style="cyan")
            )

        if result.status == RunStatus.AWAITING_IDEATION_APPROVAL:
            if click.confirm("Approve ideation output?", default=True):
                result = approve_gate(
                    client=client,
                    run_id=result.run_id,
                    gate=GATE_IDEATION,
                    run_repo=run_repo,
                    artifact_repo=artifact_repo,
                    vector_db_id=vdb,
                )

        # Display editor output
        if result.artifacts.get("editor"):
            console.print(
                Panel(result.artifacts["editor"], title="Editor: Render Plan", border_style="cyan")
            )

        if result.status == RunStatus.AWAITING_PUBLISH_APPROVAL:
            if click.confirm("Approve publish output?", default=True):
                result = approve_gate(
                    client=client,
                    run_id=result.run_id,
                    gate=GATE_PUBLISH,
                    run_repo=run_repo,
                    artifact_repo=artifact_repo,
                    vector_db_id=vdb,
                )

    final_status = (
        result.status.value if isinstance(result.status, RunStatus) else str(result.status)
    )
    console.print(f"Run {result.run_id}: {_format_status(final_status)}")


@cli.group()
def runs():
    """Manage workflow runs."""
    pass


@runs.command()
@click.option("--limit", default=10, show_default=True, type=int)
def list(limit: int):
    """List recent runs."""

    with get_session() as session:
        repo = RunRepository(session)
        runs = repo.list(limit=limit)

    _render_runs_table(runs)


@runs.command()
@click.argument("run_id")
@click.option(
    "--interval",
    default=2.0,
    show_default=True,
    type=float,
    help="Poll interval in seconds",
)
def watch(run_id: str, interval: float):
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
                console.print(f"[bold]Status[/bold] {_format_status(status)}")
                last_status = status

            if status in {RunStatus.COMPLETED.value, RunStatus.FAILED.value}:
                console.print(f"Run {run_id} finished with {_format_status(status)}")
                break

            if hasattr(session, "expire_all"):
                session.expire_all()

            time.sleep(interval)


@cli.group()
def eval():
    """Evaluation commands."""
    pass


@cli.group()
def memory():
    """Memory bank commands."""
    pass


@memory.command()
def setup():
    """Register user-preferences memory bank."""

    from memory.banks import register_memory_bank

    client = get_client()
    register_memory_bank(client, "user-preferences")
    console.print("Memory bank 'user-preferences' registered")


@memory.command()
@click.argument("user_id")
def clear(user_id: str):
    """Clear memory for a user."""

    from memory.banks import clear_user_memory

    client = get_client()
    clear_user_memory(client, user_id)
    console.print(f"Memory cleared for user: {user_id}")


@eval.command("setup-dataset")
@click.option("--dataset-id", default="ideator-eval", show_default=True)
@click.option("--seed", default="data/eval/ideator_test_cases.json", show_default=True)
def eval_setup_dataset(dataset_id: str, seed: str):
    """Register evaluation dataset and optionally seed rows."""
    import json
    from pathlib import Path

    from observability.datasets import append_rows, register_dataset

    client = get_client()
    seed_path = Path(seed)
    rows = json.loads(seed_path.read_text()) if seed_path.exists() else []

    register_dataset(client, dataset_id=dataset_id, rows=rows)

    if rows:
        try:
            append_rows(client, dataset_id=dataset_id, rows=rows)
        except RuntimeError as exc:  # pragma: no cover - depends on client capabilities
            raise click.ClickException(str(exc)) from exc

    console.print(f"Dataset '{dataset_id}' registered with {len(rows)} rows")


@eval.command("setup-benchmark")
@click.option("--benchmark-id", default="ideator-quality", show_default=True)
@click.option("--dataset-id", default="ideator-eval", show_default=True)
@click.option(
    "--scoring",
    multiple=True,
    default=["llm-as-judge::quality"],
    show_default=True,
    help="Scoring function identifiers",
)
def eval_setup_benchmark(benchmark_id: str, dataset_id: str, scoring: tuple[str, ...]):
    """Register evaluation benchmark."""

    from observability.evaluation import register_benchmark

    client = get_client()
    register_benchmark(
        client,
        benchmark_id=benchmark_id,
        dataset_id=dataset_id,
        scoring_functions=list(scoring),
    )
    console.print(f"Benchmark '{benchmark_id}' registered for dataset '{dataset_id}'")


@eval.command("run")
@click.argument("benchmark_id")
@click.option("--model", default=settings.llama_stack_model, show_default=True)
def eval_run(benchmark_id: str, model: str):
    """Run evaluation on a benchmark."""

    from observability.evaluation import run_evaluation

    client = get_client()
    result = run_evaluation(client, benchmark_id=benchmark_id, model_id=model)

    console.print(f"[bold]Evaluation Results for {benchmark_id}[/bold]")
    console.print_json(data=result)


if __name__ == "__main__":
    cli()
