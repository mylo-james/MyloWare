"""MyloWare command-line interface."""

from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

import anyio
import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from app_version import get_app_version
from llama_clients import get_sync_client, list_models, verify_connection
from config import settings
from observability.logging import get_logger
from storage.database import get_session, get_async_session_factory
from storage.repositories import ArtifactRepository, RunRepository, DeadLetterRepository
from storage.models import RunStatus, ArtifactType
from workflows.state import WorkflowResult
from workflows.langgraph.workflow import run_workflow

logger = get_logger(__name__)

console = Console()


def _vector_db_id() -> str:
    """Return configured vector DB identifier (default: project_kb)."""
    return getattr(settings, "vector_db_id", "project_kb")


def _get_project_vector_db(project: str) -> str:
    """Return vector DB ID for a project."""
    return f"project_kb_{project}"


def _format_status(status: str) -> str:
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


def _render_runs_table(runs: Iterable[Any]) -> None:
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
@click.version_option(version=get_app_version(), prog_name="myloware")
def cli() -> None:
    """MyloWare - Llama Stack multi-agent video production."""
    pass


@cli.group()
def demo() -> None:
    """Run interactive demos."""
    pass


@demo.command()
@click.argument("brief", required=False)
@click.option("--vector-db-id", help="Vector DB to use", default=None)
def aismr(brief: str | None, vector_db_id: str | None) -> None:
    """Run AISMR workflow interactively with HITL approvals."""
    if not brief:
        brief = click.prompt("Enter video brief")

    vdb = vector_db_id or _get_project_vector_db("aismr")
    console.print("[bold blue]Starting AISMR workflow...[/bold blue]")

    client = get_sync_client()
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

        status_str = (
            result.status.value if isinstance(result.status, RunStatus) else str(result.status)
        )
        if status_str == RunStatus.AWAITING_IDEATION_APPROVAL.value:
            if click.confirm("Approve ideation output?", default=True):
                from workflows.langgraph.workflow import continue_after_ideation

                run_uuid = UUID(str(result.run_id))

                async def _run() -> WorkflowResult:
                    return await continue_after_ideation(run_uuid, approved=True)

                result = anyio.run(_run)

        # Display editor output
        if result.artifacts.get("editor"):
            console.print(
                Panel(result.artifacts["editor"], title="Editor: Render Plan", border_style="cyan")
            )

        status_str = (
            result.status.value if isinstance(result.status, RunStatus) else str(result.status)
        )
        if status_str == RunStatus.AWAITING_PUBLISH_APPROVAL.value:
            if click.confirm("Approve publish output?", default=True):
                from workflows.langgraph.workflow import continue_after_publish_approval

                run_uuid = UUID(str(result.run_id))

                async def _run() -> WorkflowResult:
                    return await continue_after_publish_approval(run_uuid, approved=True)

                result = anyio.run(_run)

    final_status = (
        result.status.value if isinstance(result.status, RunStatus) else str(result.status)
    )
    console.print(f"Run {result.run_id}: {_format_status(final_status)}")


@cli.group()
def runs() -> None:
    """Manage workflow runs."""
    pass


@runs.command()
@click.option("--limit", default=10, show_default=True, type=int)
def list(limit: int) -> None:
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
                console.print(f"[bold]Status[/bold] {_format_status(status)}")
                last_status = status

            if status in {RunStatus.COMPLETED.value, RunStatus.FAILED.value}:
                console.print(f"Run {run_id} finished with {_format_status(status)}")
                break

            if hasattr(session, "expire_all"):
                session.expire_all()

            time.sleep(interval)


@runs.command()
@click.argument("run_id")
@click.option("--yes", is_flag=True, help="Skip confirmation prompt")
def resume(run_id: str, yes: bool) -> None:
    """Manually resume a stuck LangGraph workflow."""
    from workflows.langgraph.resume import resume_after_videos

    try:
        run_uuid = UUID(run_id)
    except ValueError:
        raise click.ClickException(f"Invalid run_id: {run_id} (must be a UUID)")

    if not yes:
        if not click.confirm(f"Resume workflow for run {run_id}?"):
            console.print("[yellow]Cancelled[/yellow]")
            return

    console.print(f"[bold]Resuming LangGraph workflow for run: {run_id}[/bold]")

    async def _run() -> None:
        await resume_after_videos(run_uuid, raise_on_error=True)

    try:
        anyio.run(_run)
        console.print("[green]✅ Resume triggered[/green]")
    except Exception as exc:
        raise click.ClickException(f"Failed to resume workflow: {exc}") from exc


@runs.command("fork-from-clips")
@click.argument("run_id")
@click.option(
    "--checkpoint-id",
    default=None,
    help="Optional checkpoint_id to fork from (defaults to last Sora wait checkpoint)",
)
@click.option("--yes", is_flag=True, help="Skip confirmation prompt")
def fork_from_clips_cmd(run_id: str, checkpoint_id: str | None, yes: bool) -> None:
    """Fork a failed/stuck run from existing VIDEO_CLIP artifacts.

    This is an operator-only recovery path that uses LangGraph time travel to
    reuse already-generated clips and continue from editing without new Sora spend.
    """
    from workflows.langgraph.workflow import fork_from_clips

    try:
        run_uuid = UUID(run_id)
    except ValueError:
        raise click.ClickException(f"Invalid run_id: {run_id} (must be a UUID)")

    if not yes:
        prompt = f"Fork-from-clips recovery for run {run_id}?"
        if checkpoint_id:
            prompt += f" (checkpoint_id={checkpoint_id})"
        if not click.confirm(prompt):
            console.print("[yellow]Cancelled[/yellow]")
            return

    console.print(f"[bold]Forking run from clips: {run_id}[/bold]")

    async def _run() -> Any:
        return await fork_from_clips(run_uuid, checkpoint_id=checkpoint_id)

    try:
        result = anyio.run(_run)
        final_status = (
            result.status.value if isinstance(result.status, RunStatus) else str(result.status)
        )
        console.print(
            f"[green]✅ Fork applied.[/green] Status: {_format_status(final_status)} Step: {result.current_step}"
        )
        if result.error:
            console.print(f"[red]Error:[/red] {result.error}")
    except Exception as exc:
        raise click.ClickException(f"Fork-from-clips failed: {exc}") from exc


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
    import anyio
    from observability.telemetry import query_run_traces

    console.print(f"\n[bold]👀 Monitoring run {run_id}[/bold]")
    console.print("   Using built-in observability (telemetry + database)")
    console.print(f"   Polling every {interval}s, max {max_duration}s")

    client = get_sync_client()
    start_time = time.time()
    traces_seen = set()
    last_status = None

    async def _monitor() -> None:
        nonlocal last_status
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

                # Detect status changes before updating the tracker
                if status != last_status:
                    consecutive_same_status = 0
                    console.print(f"\n[bold]Status:[/bold] {_format_status(status)}")
                    if current_step:
                        console.print(f"   Step: {current_step}")
                else:
                    consecutive_same_status += 1

                # Query new traces
                try:
                    response = query_run_traces(client, run_id, limit=100)
                    if hasattr(response, "traces") and response.traces:
                        new_traces = [
                            t
                            for t in response.traces
                            if getattr(t, "trace_id", None) not in traces_seen
                        ]
                        if new_traces:
                            console.print(f"   🔍 New traces: {len(new_traces)}")
                            traces_seen.update(
                                getattr(t, "trace_id", None)
                                for t in new_traces
                                if getattr(t, "trace_id", None)
                            )
                except Exception:
                    pass  # Telemetry might not be available

                # Check completion
                if status in {RunStatus.COMPLETED.value, RunStatus.FAILED.value}:
                    console.print(f"\n[green]✅ Run finished: {_format_status(status)}[/green]")
                    break

                # Check if stuck
                if consecutive_same_status >= max_same_status:
                    console.print(
                        f"\n[yellow]⚠️  Status unchanged for {max_same_status} polls[/yellow]"
                    )
                    break

                # Update tracker after checks
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
        artifacts = repo.get_by_run(run_uuid)

        if not artifacts:
            console.print(f"[yellow]No artifacts found for run {run_id}[/yellow]")
            return

        table = Table(title=f"Artifacts for Run {run_id}", show_lines=False)
        table.add_column("Type", style="cyan")
        table.add_column("Persona", style="white")
        table.add_column("Size", style="dim")
        table.add_column("URI", style="dim")

        for art in artifacts:
            size = f"{len(art.content)} chars" if art.content else "-"
            uri = art.uri or "-"
            table.add_row(art.artifact_type, art.persona or "-", size, uri)

        console.print(table)

        # Show producer/editor output if available
        for art in artifacts:
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
    from observability.telemetry import query_run_traces

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
            console.print(f"{status_icon} {name} ({trace_id[:16] if trace_id else 'unknown'}...)")
            if start_time:
                console.print(f"   Time: {start_time}")

    except Exception as exc:
        console.print(f"[yellow]Failed to fetch logs: {exc}[/yellow]")
        console.print("[dim]Telemetry may not be available[/dim]")


@cli.group()
def dev() -> None:
    """Development utilities."""
    pass


@dev.command("check-env")
def dev_check_env() -> None:
    """Validate environment configuration."""
    import os
    from pathlib import Path

    env_file = Path(".env")
    if env_file.exists():
        try:
            from dotenv import load_dotenv

            load_dotenv(env_file)
        except ImportError:
            pass

    required = ["USE_LANGGRAPH_ENGINE", "DATABASE_URL", "API_KEY", "WEBHOOK_BASE_URL"]
    optional = ["OPENAI_API_KEY", "REMOTION_SERVICE_URL", "UPLOAD_POST_API_KEY"]

    missing = [k for k in required if not os.getenv(k)]
    unset_optional = [k for k in optional if not os.getenv(k)]

    if missing:
        console.print(f"[red]Missing required env vars:[/red] {', '.join(missing)}")
        raise SystemExit(1)
    else:
        console.print("[green]✓ Required env vars present[/green]")

    if unset_optional:
        console.print(
            f"[yellow]Optional env vars not set (ok if using fakes):[/yellow] {', '.join(unset_optional)}"
        )


@dev.command("test-agent")
@click.argument("run_id")
def dev_test_agent(run_id: str) -> None:
    """Test/analyze agent output format from a run."""
    import re

    try:
        run_uuid = UUID(run_id)
    except ValueError:
        raise click.ClickException(f"Invalid run_id: {run_id} (must be a UUID)")

    with get_session() as session:
        artifact_repo = ArtifactRepository(session)
        artifacts = artifact_repo.get_by_run(run_uuid)

        editor_artifacts = [
            a for a in artifacts if a.artifact_type == ArtifactType.EDITOR_OUTPUT.value
        ]

        if not editor_artifacts:
            console.print(f"[yellow]No editor output artifacts found for run {run_id}[/yellow]")
            return

        editor_artifact = editor_artifacts[-1]
        editor_output = editor_artifact.content

        console.print("=" * 70)
        console.print(f"[bold]ANALYZING EDITOR OUTPUT FOR RUN: {run_id}[/bold]")
        console.print("=" * 70)
        console.print(f"\nArtifact ID: {editor_artifact.id}")
        console.print(f"Created: {editor_artifact.created_at}")
        console.print("\n[bold]OUTPUT PREVIEW (first 1000 chars):[/bold]")
        console.print("-" * 70)
        console.print(editor_output[:1000])

        # Try to extract render_job_id
        patterns = [
            (
                r"## Tool Results.*?remotion_render.*?```json\s*(\{.*?\})\s*```",
                "tool_results_section",
            ),
            (r'## Tool Results.*?```json\s*(\{.*?"job_id".*?\})\s*```', "tool_results_any"),
            (r'### Tool \d+.*?```json\s*(\{.*?"job_id".*?\})\s*```', "tool_numbered"),
            (r"remotion_render.*?```json\s*(\{.*?\})\s*```", "remotion_json_block"),
            (r'"job_id"\s*:\s*"([^"]+)"', "json_quoted"),
        ]

        render_job_id = None
        for pattern, pattern_name in patterns:
            match = re.search(pattern, editor_output, re.DOTALL | re.IGNORECASE)
            if match:
                try:
                    json_str = match.group(1)
                    tool_result_json = json.loads(json_str)
                    render_job_id = (
                        tool_result_json.get("data", {}).get("job_id")
                        or tool_result_json.get("job_id")
                        or tool_result_json.get("data", {}).get("data", {}).get("job_id")
                    )
                    if render_job_id:
                        console.print(f"\n[green]✅ Extracted job_id: {render_job_id}[/green]")
                        console.print(f"   Method: {pattern_name}")
                        break
                except (json.JSONDecodeError, Exception):
                    continue

        if not render_job_id:
            console.print("\n[yellow]❌ No job_id found in output[/yellow]")


@dev.command("e2e")
@click.option("--base-url", help="Use a running server instead of in-process app")
@click.option("--api-key", default="dev-api-key", help="API key for requests")
@click.option("--workflow", default="aismr", help="Workflow/project name")
@click.option("--brief", default="Async e2e smoke test", help="Brief to submit")
def dev_e2e(base_url: str | None, api_key: str, workflow: str, brief: str) -> None:
    """Run end-to-end tests locally."""
    import subprocess
    import sys

    cmd = [sys.executable, "scripts/e2e_local.py"]
    if base_url:
        cmd.extend(["--base-url", base_url])
    cmd.extend(["--api-key", api_key])
    cmd.extend(["--workflow", workflow])
    cmd.extend(["--brief", brief])

    result = subprocess.run(cmd, cwd=".")
    raise SystemExit(result.returncode)


@cli.group()
def traces() -> None:
    """Trace and observability commands."""
    pass


@traces.command("watch")
@click.option("--interval", default=5, show_default=True, type=int, help="Poll interval in seconds")
def traces_watch(interval: int) -> None:
    """Watch Llama Stack traces in real-time."""

    client = get_sync_client()
    seen_traces = set()

    console.print("[bold]🔍 Watching Llama Stack traces...[/bold] (Ctrl+C to stop)")
    console.print(f"   Llama Stack URL: {client._base_url}")
    console.print(f"   Polling every {interval}s")
    console.print("-" * 70)

    try:
        while True:
            try:
                response = client.telemetry.query_traces(limit=20)
                traces = getattr(response, "traces", []) or []

                new_traces = []
                for trace in traces:
                    trace_id = getattr(trace, "trace_id", None) or trace.get("trace_id")
                    if trace_id and trace_id not in seen_traces:
                        seen_traces.add(trace_id)
                        if hasattr(trace, "model_dump"):
                            trace = trace.model_dump()
                        elif hasattr(trace, "dict"):
                            trace = trace.dict()
                        new_traces.append(trace)

                for trace in reversed(new_traces):
                    trace_id = trace.get("trace_id", "unknown")[:16]
                    name = trace.get("name", "unknown")
                    start_time = trace.get("start_time", "")
                    status = trace.get("status", "unknown")

                    status_icon = "✓" if status == "OK" else "✗" if status == "ERROR" else "?"
                    console.print(f"\n{'='*70}")
                    console.print(f"{status_icon} TRACE: {trace_id}...")
                    console.print(f"   Name: {name}")
                    console.print(f"   Time: {start_time} | Status: {status}")
                    console.print(f"{'='*70}")

                time.sleep(interval)

            except KeyboardInterrupt:
                console.print("\n\n[yellow]👋 Stopped watching traces[/yellow]")
                break
            except Exception as e:
                console.print(f"[yellow]⚠️ Error: {e}[/yellow]")
                time.sleep(interval)

    except Exception as exc:
        raise click.ClickException(f"Failed to watch traces: {exc}") from exc


@cli.group()
def eval() -> None:
    """Evaluation commands."""
    pass


@cli.group()
def memory() -> None:
    """Memory bank commands."""
    pass


@memory.command()
def setup() -> None:
    """Register user-preferences memory bank."""

    from memory.banks import register_memory_bank

    client = get_sync_client()
    register_memory_bank(client, "user-preferences")
    console.print("Memory bank 'user-preferences' registered")


@memory.command()
@click.argument("user_id")
def clear(user_id: str) -> None:
    """Clear memory for a user."""

    from memory.banks import clear_user_memory

    client = get_sync_client()
    clear_user_memory(client, user_id)
    console.print(f"Memory cleared for user: {user_id}")


@eval.command("setup-dataset")
@click.option("--dataset-id", default="ideator-eval", show_default=True)
@click.option("--seed", default="data/eval/ideator_test_cases.json", show_default=True)
def eval_setup_dataset(dataset_id: str, seed: str) -> None:
    """Register evaluation dataset and optionally seed rows."""
    import json
    from pathlib import Path

    from observability.datasets import append_rows, register_dataset

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

    from observability.evaluation import register_benchmark

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

    from observability.evaluation import run_evaluation

    client = get_sync_client()
    result = run_evaluation(client, benchmark_id=benchmark_id, model_id=model)

    console.print(f"[bold]Evaluation Results for {benchmark_id}[/bold]")
    console.print_json(data=result)


@cli.group()
def webhooks() -> None:
    """Webhook utilities (DLQ replay, etc.)."""
    pass


@webhooks.command("replay")
@click.argument("dead_letter_id")
def webhooks_replay(dead_letter_id: str) -> None:
    """Replay a dead-lettered webhook by ID."""
    import anyio
    from uuid import UUID
    from workflows.dlq_replay import replay_dead_letter

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


@cli.group()
def stack() -> None:
    """Llama Stack management and inspection."""
    pass


@stack.command("models")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_models(output_json: bool) -> None:
    """List available models from Llama Stack."""
    try:
        client = get_sync_client()
        models = list_models(client)
        if output_json:
            console.print_json(data={"models": models, "count": len(models)})
        else:
            table = Table(title="Available Models", show_lines=False)
            table.add_column("Model ID", style="cyan")
            for model_id in models:
                table.add_row(model_id)
            console.print(table)
            console.print(f"\n[dim]Total: {len(models)} models[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list models: {exc}") from exc


@stack.command("status")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_status(output_json: bool) -> None:
    """Check Llama Stack server status and verify connection."""
    try:
        client = get_sync_client()
        result = verify_connection(client)
        if output_json:
            console.print_json(data=result)
        else:
            if result["success"]:
                console.print("[green]✓ Connection verified[/green]")
                console.print(f"  Models available: {result['models_available']}")
                console.print(f"  Model tested: {result['model_tested']}")
                console.print(f"  Inference works: {'Yes' if result['inference_works'] else 'No'}")
            else:
                console.print("[red]✗ Connection failed[/red]")
                console.print(f"  Error: {result.get('error', 'Unknown error')}")
                if result.get("models_available", 0) > 0:
                    console.print(f"  Models available: {result['models_available']}")
    except Exception as exc:
        raise click.ClickException(f"Failed to verify connection: {exc}") from exc


@stack.command("inspect")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_inspect(output_json: bool) -> None:
    """Inspect Llama Stack server configuration."""
    try:
        client = get_sync_client()
        version_info = client.inspect.version()
        if output_json:
            console.print_json(data={"version": str(version_info)})
        else:
            console.print(f"[bold]Llama Stack Version:[/bold] {version_info}")
    except Exception as exc:
        raise click.ClickException(f"Failed to inspect server: {exc}") from exc


@stack.command("toolgroups")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_toolgroups(output_json: bool) -> None:
    """List registered toolgroups."""
    try:
        client = get_sync_client()
        toolgroups = list(client.toolgroups.list())
        if output_json:
            data = [{"id": tg.id, "name": getattr(tg, "name", "")} for tg in toolgroups]
            console.print_json(data={"toolgroups": data, "count": len(data)})
        else:
            table = Table(title="Registered Toolgroups", show_lines=False)
            table.add_column("ID", style="cyan")
            table.add_column("Name", style="white")
            for tg in toolgroups:
                table.add_row(tg.id, getattr(tg, "name", ""))
            console.print(table)
            console.print(f"\n[dim]Total: {len(toolgroups)} toolgroups[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list toolgroups: {exc}") from exc


@stack.command("providers")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_providers(output_json: bool) -> None:
    """List configured providers."""
    try:
        client = get_sync_client()
        providers = list(client.providers.list())
        if output_json:
            data = [{"id": p.id, "name": getattr(p, "name", "")} for p in providers]
            console.print_json(data={"providers": data, "count": len(data)})
        else:
            table = Table(title="Configured Providers", show_lines=False)
            table.add_column("ID", style="cyan")
            table.add_column("Name", style="white")
            for p in providers:
                table.add_row(p.id, getattr(p, "name", ""))
            console.print(table)
            console.print(f"\n[dim]Total: {len(providers)} providers[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list providers: {exc}") from exc


@stack.command("shields")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
@click.argument("shield_id", required=False)
def stack_shields(shield_id: str | None, output_json: bool) -> None:
    """List or inspect safety shields."""
    try:
        client = get_sync_client()
        if shield_id:
            shield = client.shields.retrieve(shield_id)
            if output_json:
                console.print_json(
                    data={"shield": {"id": shield.id, "name": getattr(shield, "name", "")}}
                )
            else:
                console.print(f"[bold]Shield:[/bold] {shield.id}")
                console.print(f"  Name: {getattr(shield, 'name', 'N/A')}")
        else:
            shields = list(client.shields.list())
            if output_json:
                data = [{"id": s.id, "name": getattr(s, "name", "")} for s in shields]
                console.print_json(data={"shields": data, "count": len(data)})
            else:
                table = Table(title="Safety Shields", show_lines=False)
                table.add_column("ID", style="cyan")
                table.add_column("Name", style="white")
                for s in shields:
                    table.add_row(s.id, getattr(s, "name", ""))
                console.print(table)
                console.print(f"\n[dim]Total: {len(shields)} shields[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list/inspect shields: {exc}") from exc


@stack.group("vector-dbs")
def stack_vector_dbs() -> None:
    """Manage vector databases (vector stores)."""
    pass


@stack_vector_dbs.command("list")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_vector_dbs_list(output_json: bool) -> None:
    """List vector databases."""
    try:
        client = get_sync_client()
        vector_dbs = list(client.vector_stores.list())
        if output_json:
            data = [{"id": vs.id, "name": getattr(vs, "name", "")} for vs in vector_dbs]
            console.print_json(data={"vector_dbs": data, "count": len(data)})
        else:
            table = Table(title="Vector Databases", show_lines=False)
            table.add_column("ID", style="cyan")
            table.add_column("Name", style="white")
            for vs in vector_dbs:
                table.add_row(vs.id, getattr(vs, "name", ""))
            console.print(table)
            console.print(f"\n[dim]Total: {len(vector_dbs)} vector databases[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list vector databases: {exc}") from exc


@stack_vector_dbs.command("register")
@click.argument("name")
@click.option("--provider-id", help="Provider ID (milvus|pgvector, default: auto-detect)")
@click.option(
    "--embedding-model",
    default="openai/text-embedding-3-small",
    show_default=True,
    help="Embedding model for the vector DB",
)
@click.option(
    "--embedding-dimension",
    default=None,
    type=int,
    help="Embedding dimension (optional; provider default if omitted)",
)
@click.option(
    "--chunk-size", default=512, show_default=True, type=int, help="Max chunk size in tokens"
)
@click.option(
    "--chunk-overlap", default=100, show_default=True, type=int, help="Chunk overlap in tokens"
)
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_vector_dbs_register(
    name: str,
    provider_id: str | None,
    embedding_model: str,
    embedding_dimension: int | None,
    chunk_size: int,
    chunk_overlap: int,
    output_json: bool,
) -> None:
    """Register a new vector DB."""
    try:
        client = get_sync_client()
        if provider_id is None:
            provider_id = "milvus" if settings.milvus_uri else "pgvector"

        extra_body = {
            "provider_id": provider_id,
            "embedding_model": embedding_model,
        }
        if embedding_dimension:
            extra_body["embedding_dimension"] = embedding_dimension

        store = client.vector_stores.create(
            name=name,
            chunking_strategy={
                "type": "static",
                "static": {
                    "max_chunk_size_tokens": chunk_size,
                    "chunk_overlap_tokens": chunk_overlap,
                },
            },
            extra_body=extra_body,
        )

        if output_json:
            console.print_json(
                data={
                    "id": store.id,
                    "name": getattr(store, "name", ""),
                    "provider_id": provider_id,
                    "embedding_model": embedding_model,
                }
            )
        else:
            console.print("[green]Vector DB created[/green]")
            console.print(f"  ID: {store.id}")
            console.print(f"  Name: {getattr(store, 'name', '')}")
            console.print(f"  Provider: {provider_id}")
            console.print(f"  Embedding model: {embedding_model}")
    except Exception as exc:
        raise click.ClickException(f"Failed to register vector database: {exc}") from exc


@stack.command("datasets")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_datasets(output_json: bool) -> None:
    """List evaluation datasets."""
    try:
        client = get_sync_client()
        datasets = list(client.datasets.list())
        if output_json:
            data = [{"id": ds.id, "name": getattr(ds, "name", "")} for ds in datasets]
            console.print_json(data={"datasets": data, "count": len(data)})
        else:
            table = Table(title="Evaluation Datasets", show_lines=False)
            table.add_column("ID", style="cyan")
            table.add_column("Name", style="white")
            for ds in datasets:
                table.add_row(ds.id, getattr(ds, "name", ""))
            console.print(table)
            console.print(f"\n[dim]Total: {len(datasets)} datasets[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list datasets: {exc}") from exc


@stack.command("chat")
@click.argument("prompt")
@click.option("--model", help="Model to use (default: from settings)")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_chat(prompt: str, model: str | None, output_json: bool) -> None:
    """Quick smoke test: send a chat completion to Llama Stack."""
    try:
        client = get_sync_client()
        model_id = model or settings.llama_stack_model
        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            stream=False,
        )
        content = None
        if response.choices:
            message = response.choices[0].message
            content = getattr(message, "content", None)
        if output_json:
            console.print_json(data={"model": model_id, "response": content})
        else:
            console.print(f"[bold]Model:[/bold] {model_id}")
            console.print(f"[bold]Response:[/bold]\n{content or '(empty)'}")
    except Exception as exc:
        raise click.ClickException(f"Chat completion failed: {exc}") from exc


@cli.group()
def kb() -> None:
    """Knowledge base commands."""
    pass


@kb.command("setup")
@click.option("--project", default="global", show_default=True, help="Project ID for KB")
@click.option("--force", is_flag=True, help="Force re-ingestion even if store exists")
@click.option("--verbose", "-v", is_flag=True, help="Verbose output with detailed logging")
@click.option("--provider-id", help="Vector DB provider (milvus|pgvector, default: auto-detect)")
@click.option(
    "--embedding-model",
    default="openai/text-embedding-3-small",
    show_default=True,
    help="Embedding model",
)
@click.option(
    "--embedding-dimension",
    default=None,
    type=int,
    help="Embedding dimension (optional; provider default if omitted)",
)
@click.option(
    "--chunk-size", default=512, show_default=True, type=int, help="Max chunk size in tokens"
)
@click.option(
    "--chunk-overlap", default=100, show_default=True, type=int, help="Chunk overlap in tokens"
)
def kb_setup(
    project: str,
    force: bool,
    verbose: bool,
    provider_id: str | None,
    embedding_model: str,
    embedding_dimension: int | None,
    chunk_size: int,
    chunk_overlap: int,
) -> None:
    """Set up knowledge base by ingesting all KB documents.

    Creates a vector store and ingests all documents from data/knowledge/.
    Waits for processing to complete and reports status.
    """
    from knowledge.loader import load_documents_with_manifest
    from knowledge.setup import setup_project_knowledge

    if verbose:
        console.print("[dim]Verbose mode enabled[/dim]")

    client = get_sync_client()

    if verbose:
        base_url = getattr(client, "_base_url", None) or settings.llama_stack_url
        console.print(f"[dim]Connected to: {base_url}[/dim]")

    # Load knowledge documents (global + optional per-project)
    docs_project_id = None if project == "global" else project
    console.print("[bold]Loading knowledge documents...[/bold]")
    docs, manifest = load_documents_with_manifest(
        docs_project_id, include_global=True, read_content=True
    )

    # Convert to Llama Stack file upload docs format
    doc_dicts = [
        {
            "id": d.id,
            "content": d.content,
            "metadata": {
                **(d.metadata or {}),
                "filename": d.filename,
                "type": "knowledge",
            },
        }
        for d in docs
    ]

    console.print(f"  Docs loaded: {len(doc_dicts)}")
    console.print(f"  Manifest hash: {manifest.get('hash')}")

    console.print(f"\n[bold]Setting up vector store for project: {project}[/bold]")
    vector_store_id = setup_project_knowledge(
        client=client,
        project_id=project,
        documents=doc_dicts if doc_dicts else None,
        force_reingest=force,
        provider_id=provider_id,
        embedding_model=embedding_model,
        embedding_dimension=embedding_dimension,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    console.print("[green]KB setup complete[/green]")
    console.print(f"  Vector store: {vector_store_id}")


@kb.command("validate")
@click.option("--vector-store-id", default=None, help="Vector store ID to validate")
def kb_validate(vector_store_id: str | None) -> None:
    """Validate KB retrieval quality with test queries."""
    import subprocess
    import sys

    cmd = [sys.executable, "scripts/validate_kb.py"]
    if vector_store_id:
        cmd.extend(["--vector-store-id", vector_store_id])

    result = subprocess.run(cmd, cwd=".")
    raise SystemExit(result.returncode)


@cli.command("config")
@click.argument("action", type=click.Choice(["show"], case_sensitive=False))
def config_show(action: str) -> None:
    """Show key configuration settings."""
    table = Table(title="MyloWare Configuration", show_lines=False)
    table.add_column("Setting", style="cyan")
    table.add_column("Value", style="white")

    table.add_row("Llama Stack URL", settings.llama_stack_url)
    table.add_row("Model", settings.llama_stack_model)
    table.add_row("Project ID", settings.project_id)
    table.add_row("Vector DB Provider", "milvus" if settings.milvus_uri else "pgvector")
    table.add_row(
        "Database URL",
        (
            settings.database_url.split("@")[-1]
            if "@" in settings.database_url
            else settings.database_url
        ),
    )
    table.add_row("API Host", settings.api_host)
    table.add_row("API Port", str(settings.api_port))
    table.add_row("Environment", settings.environment)

    console.print(table)


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
    """Run LLM-as-judge evaluation and exit with pass/fail status.

    Loads test cases from --dataset, generates outputs, scores with LLM-as-judge,
    and exits 0 if median score >= threshold, 1 otherwise.

    Use in CI/CD: make eval
    """
    import sys
    from pathlib import Path

    from observability.evaluation import load_eval_dataset, run_eval_pipeline

    # Load dataset
    try:
        cases = load_eval_dataset(Path(dataset))
    except FileNotFoundError:
        console.print(f"[red]Dataset not found: {dataset}[/red]")
        sys.exit(1)
    except Exception as e:
        console.print(f"[red]Failed to load dataset: {e}[/red]")
        sys.exit(1)

    console.print(f"[bold]Loaded {len(cases)} test cases from {dataset}[/bold]")

    if dry_run:
        console.print("[yellow]Dry run - not running evaluation[/yellow]")
        for case in cases[:5]:
            console.print(f"  {case.id}: {case.input[:60]}...")
        if len(cases) > 5:
            console.print(f"  ... and {len(cases) - 5} more")
        sys.exit(0)

    # Run evaluation
    client = get_sync_client()
    console.print(f"[bold]Running evaluation (threshold={threshold})...[/bold]")

    result = run_eval_pipeline(
        client=client,
        cases=cases,
        threshold=threshold,
        model_id=model,
    )

    # Display results
    console.print("")
    console.print(Panel(result.summary, title="Evaluation Results", border_style="cyan"))

    # Detailed results table
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

    # Exit with appropriate code
    if result.passed:
        console.print("[green]Evaluation PASSED[/green]")
        sys.exit(0)
    else:
        console.print("[red]Evaluation FAILED[/red]")
        sys.exit(1)


if __name__ == "__main__":
    cli()
