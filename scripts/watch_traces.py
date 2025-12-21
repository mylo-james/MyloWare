#!/usr/bin/env python3
"""Watch Llama Stack traces in real-time via console.

Uses Llama Stack's native Telemetry API (not Jaeger directly).

Usage:
    python scripts/watch_traces.py

Or with make:
    make watch-traces
"""

import os
import sys
import time
from datetime import datetime

from llama_stack_client import LlamaStackClient

# Force unbuffered output for real-time display
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

LLAMA_STACK_URL = os.getenv("LLAMA_STACK_URL", "http://localhost:5001")


def get_client() -> LlamaStackClient:
    """Get Llama Stack client."""
    return LlamaStackClient(base_url=LLAMA_STACK_URL)


def format_trace(trace: dict) -> str:
    """Format a trace for console output."""
    lines = []

    trace_id = trace.get("trace_id", "unknown")[:16]
    start_time = trace.get("start_time", "")
    end_time = trace.get("end_time", "")
    status = trace.get("status", "unknown")
    attributes = trace.get("attributes", {})

    # Format timestamp
    if start_time:
        try:
            ts = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            timestamp = ts.strftime("%H:%M:%S")
        except Exception:
            timestamp = start_time[:8]
    else:
        timestamp = "?"

    # Calculate duration if we have both times
    duration_str = ""
    if start_time and end_time:
        try:
            start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            duration_ms = (end - start).total_seconds() * 1000
            duration_str = f" | Duration: {duration_ms:.1f}ms"
        except Exception:
            duration_str = ""

    status_icon = "✓" if status == "OK" else "✗" if status == "ERROR" else "?"

    lines.append(f"\n{'='*70}")
    lines.append(f"{status_icon} TRACE: {trace_id}...")
    lines.append(f"   Time: {timestamp}{duration_str} | Status: {status}")

    if attributes:
        lines.append(f"   Attributes: {attributes}")

    lines.append(f"{'='*70}")
    return "\n".join(lines)


def format_span(span: dict) -> str:
    """Format a span for console output."""
    name = span.get("name", "unknown")
    status = span.get("status", "unknown")
    start_time = span.get("start_time", "")
    end_time = span.get("end_time", "")

    # Calculate duration
    duration_str = ""
    if start_time and end_time:
        try:
            start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            duration_ms = (end - start).total_seconds() * 1000
            duration_str = f" ({duration_ms:.1f}ms)"
        except Exception:
            duration_str = ""

    status_icon = "✓" if status == "OK" else "✗" if status == "ERROR" else "○"
    return f"      {status_icon} {name}{duration_str}"


def watch_traces(poll_interval: int = 5):
    """Poll Llama Stack Telemetry API for new traces and print them."""
    seen_traces = set()

    print("🔍 Watching Llama Stack traces... (Ctrl+C to stop)", flush=True)
    print(f"   Llama Stack URL: {LLAMA_STACK_URL}", flush=True)
    print(f"   Polling every {poll_interval}s", flush=True)
    print("-" * 70, flush=True)

    client = get_client()

    while True:
        try:
            # Query recent traces using Llama Stack Telemetry API
            # Note: start_time/end_time filters may vary by provider
            response = client.telemetry.query_traces(
                limit=20,
            )

            traces = getattr(response, "traces", []) or []

            new_traces = []
            for trace in traces:
                trace_id = getattr(trace, "trace_id", None) or trace.get("trace_id")
                if trace_id and trace_id not in seen_traces:
                    seen_traces.add(trace_id)
                    # Convert to dict if it's a Pydantic model
                    if hasattr(trace, "model_dump"):
                        trace = trace.model_dump()
                    elif hasattr(trace, "dict"):
                        trace = trace.dict()
                    new_traces.append(trace)

            # Print new traces (most recent first)
            for trace in reversed(new_traces):
                formatted = format_trace(trace)
                print(formatted, flush=True)

                # Try to get spans for this trace
                trace_id = trace.get("trace_id")
                if trace_id:
                    try:
                        span_response = client.telemetry.query_spans(
                            trace_id=trace_id,
                            limit=10,
                        )
                        spans = getattr(span_response, "spans", []) or []
                        if spans:
                            print("   📝 Spans:", flush=True)
                            for span in spans:
                                if hasattr(span, "model_dump"):
                                    span = span.model_dump()
                                elif hasattr(span, "dict"):
                                    span = span.dict()
                                print(format_span(span), flush=True)
                    except Exception:
                        # Span query may not be supported by all providers
                        spans = []

            time.sleep(poll_interval)

        except KeyboardInterrupt:
            print("\n\n👋 Stopped watching traces", flush=True)
            break
        except Exception as e:
            print(f"⚠️ Error: {e}", flush=True)
            time.sleep(poll_interval)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Watch Llama Stack traces")
    parser.add_argument("--interval", "-i", type=int, default=5, help="Poll interval (seconds)")
    args = parser.parse_args()

    watch_traces(poll_interval=args.interval)
