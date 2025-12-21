"""Demo CLI commands."""

from __future__ import annotations

from uuid import UUID

import anyio
import click
from rich.panel import Panel

from myloware.llama_clients import get_sync_client
from myloware.storage.database import get_session
from myloware.storage.models import RunStatus
from myloware.storage.repositories import ArtifactRepository, RunRepository
from myloware.workflows.langgraph.workflow import run_workflow
from myloware.workflows.state import WorkflowResult
from myloware.cli.ui import console, format_status


def _get_project_vector_db(project: str) -> str:
    return f"project_kb_{project}"


@click.group()
def demo() -> None:
    """Run interactive demos."""


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
                from myloware.workflows.langgraph.workflow import continue_after_ideation

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
                from myloware.workflows.langgraph.workflow import continue_after_publish_approval

                run_uuid = UUID(str(result.run_id))

                async def _run() -> WorkflowResult:
                    return await continue_after_publish_approval(run_uuid, approved=True)

                result = anyio.run(_run)

    final_status = (
        result.status.value if isinstance(result.status, RunStatus) else str(result.status)
    )
    console.print(f"Run {result.run_id}: {format_status(final_status)}")


def register(cli: click.Group) -> None:
    cli.add_command(demo)
