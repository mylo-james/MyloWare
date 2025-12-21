"""Developer CLI commands."""

from __future__ import annotations

import json
from uuid import UUID

import click

from myloware.cli.ui import console
from myloware.storage.database import get_session
from myloware.storage.models import ArtifactType
from myloware.storage.repositories import ArtifactRepository


@click.group()
def dev() -> None:
    """Development utilities."""


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
    console.print("[green]✓ Required env vars present[/green]")

    if unset_optional:
        console.print(
            "[yellow]Optional env vars not set (ok if using fakes):[/yellow] "
            + ", ".join(unset_optional)
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
        editor_output = str(editor_artifact.content or "")

        console.print("=" * 70)
        console.print(f"[bold]ANALYZING EDITOR OUTPUT FOR RUN: {run_id}[/bold]")
        console.print("=" * 70)
        console.print(f"\nArtifact ID: {editor_artifact.id}")
        console.print(f"Created: {editor_artifact.created_at}")
        console.print("\n[bold]OUTPUT PREVIEW (first 1000 chars):[/bold]")
        console.print("-" * 70)
        console.print(editor_output[:1000])

        patterns = [
            (
                r"## Tool Results.*?remotion_render.*?```json\s*(\{.*?\})\s*```",
                "tool_results_section",
            ),
            (r"## Tool Results.*?```json\s*(\{.*?\"job_id\".*?\})\s*```", "tool_results_any"),
            (r"### Tool \d+.*?```json\s*(\{.*?\"job_id\".*?\})\s*```", "tool_numbered"),
            (r"remotion_render.*?```json\s*(\{.*?\})\s*```", "remotion_json_block"),
            (r"\"job_id\"\s*:\s*\"([^\"]+)\"", "json_quoted"),
        ]

        render_job_id = None
        for pattern, pattern_name in patterns:
            match = re.search(pattern, editor_output, re.DOTALL | re.IGNORECASE)
            if not match:
                continue
            if pattern_name == "json_quoted":
                render_job_id = match.group(1).strip()
                if render_job_id:
                    console.print(f"\n[green]✅ Extracted job_id: {render_job_id}[/green]")
                    console.print(f"   Method: {pattern_name}")
                    break
                continue
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
    import subprocess  # nosec B404
    import sys

    cmd = [sys.executable, "scripts/e2e_local.py"]
    if base_url:
        cmd.extend(["--base-url", base_url])
    cmd.extend(["--api-key", api_key])
    cmd.extend(["--workflow", workflow])
    cmd.extend(["--brief", brief])

    result = subprocess.run(cmd, cwd=".", check=False)  # nosec B603
    raise SystemExit(result.returncode)


def register(cli: click.Group) -> None:
    cli.add_command(dev)
