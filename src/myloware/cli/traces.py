"""Trace/telemetry CLI commands."""

from __future__ import annotations

import time

import click

from myloware.cli.ui import console
from myloware.llama_clients import get_sync_client


@click.group()
def traces() -> None:
    """Trace and observability commands."""


@traces.command("watch")
@click.option("--interval", default=5, show_default=True, type=int, help="Poll interval in seconds")
def traces_watch(interval: int) -> None:
    """Watch Llama Stack traces in real-time."""
    client = get_sync_client()
    seen_traces: set[str] = set()

    console.print("[bold]🔍 Watching Llama Stack traces...[/bold] (Ctrl+C to stop)")
    console.print(f"   Llama Stack URL: {getattr(client, '_base_url', '')}")
    console.print(f"   Polling every {interval}s")
    console.print("-" * 70)

    try:
        while True:
            try:
                response = client.telemetry.query_traces(limit=20)
                traces = getattr(response, "traces", []) or []

                new_traces: list[dict] = []
                for trace in traces:
                    trace_id = getattr(trace, "trace_id", None) or (
                        trace.get("trace_id") if isinstance(trace, dict) else None
                    )
                    if trace_id and trace_id not in seen_traces:
                        seen_traces.add(trace_id)
                        if hasattr(trace, "model_dump"):
                            trace = trace.model_dump()
                        elif hasattr(trace, "dict"):
                            trace = trace.dict()
                        new_traces.append(trace)

                for trace in reversed(new_traces):
                    trace_id = str(trace.get("trace_id", "unknown"))[:16]
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


def register(cli: click.Group) -> None:
    cli.add_command(traces)
