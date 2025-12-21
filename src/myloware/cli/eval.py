"""Evaluation CLI commands."""

from __future__ import annotations

import sys
from pathlib import Path

import click
from rich.panel import Panel
from rich.table import Table

from myloware.cli.ui import console
from myloware.config import settings
from myloware.llama_clients import get_sync_client


@click.group()
def eval() -> None:
    """Evaluation commands."""


@eval.command("setup-dataset")
@click.option("--dataset-id", default="ideator-eval", show_default=True)
@click.option("--seed", default="data/eval/ideator_test_cases.json", show_default=True)
def eval_setup_dataset(dataset_id: str, seed: str) -> None:
    """Register evaluation dataset and optionally seed rows."""
    import json

    from myloware.observability.datasets import append_rows, register_dataset

    client = get_sync_client()
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
def eval_setup_benchmark(benchmark_id: str, dataset_id: str, scoring: tuple[str, ...]) -> None:
    """Register evaluation benchmark."""
    from myloware.observability.evaluation import register_benchmark

    client = get_sync_client()
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
def eval_run(benchmark_id: str, model: str) -> None:
    """Run evaluation on a benchmark."""
    from myloware.observability.evaluation import run_evaluation

    client = get_sync_client()
    result = run_evaluation(client, benchmark_id=benchmark_id, model_id=model)

    console.print(f"[bold]Evaluation Results for {benchmark_id}[/bold]")
    console.print_json(data=result)


@eval.command("score")
@click.option(
    "--dataset",
    default="data/eval/ideator_test_cases.json",
    show_default=True,
    help="Path to eval dataset JSON",
)
@click.option(
    "--threshold",
    default=3.5,
    show_default=True,
    type=float,
    help="Minimum median score to pass",
)
@click.option("--model", default=None, help="Model for judge (default: from settings)")
@click.option("--dry-run", is_flag=True, help="Load dataset but don't run eval")
def eval_score(dataset: str, threshold: float, model: str | None, dry_run: bool) -> None:
    """Run LLM-as-judge evaluation and exit with pass/fail status."""
    from myloware.observability.evaluation import load_eval_dataset, run_eval_pipeline

    try:
        cases = load_eval_dataset(Path(dataset))
    except FileNotFoundError:
        console.print(f"[red]Dataset not found: {dataset}[/red]")
        sys.exit(1)
    except Exception as exc:
        console.print(f"[red]Failed to load dataset: {exc}[/red]")
        sys.exit(1)

    console.print(f"[bold]Loaded {len(cases)} test cases from {dataset}[/bold]")

    if dry_run:
        console.print("[yellow]Dry run - not running evaluation[/yellow]")
        for case in cases[:5]:
            console.print(f"  {case.id}: {case.input[:60]}...")
        if len(cases) > 5:
            console.print(f"  ... and {len(cases) - 5} more")
        sys.exit(0)

    client = get_sync_client()
    console.print(f"[bold]Running evaluation (threshold={threshold})...[/bold]")

    result = run_eval_pipeline(client=client, cases=cases, threshold=threshold, model_id=model)

    console.print("")
    console.print(Panel(result.summary, title="Evaluation Results", border_style="cyan"))

    table = Table(title="Per-Case Scores", show_lines=False)
    table.add_column("ID", style="white")
    table.add_column("Score", style="bold")
    table.add_column("Reasoning", style="dim", max_width=60)

    for detail in result.details:
        score_color = "green" if detail.score >= threshold else "red"
        table.add_row(
            detail.case_id,
            f"[{score_color}]{detail.score:.1f}[/{score_color}]",
            detail.reasoning[:60] + ("..." if len(detail.reasoning) > 60 else ""),
        )

    console.print(table)

    if result.passed:
        console.print("[green]Evaluation PASSED[/green]")
        sys.exit(0)

    console.print("[red]Evaluation FAILED[/red]")
    sys.exit(1)


def register(cli: click.Group) -> None:
    cli.add_command(eval)
