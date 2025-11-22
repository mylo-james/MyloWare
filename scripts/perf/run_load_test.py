"""Simple load test harness for MyloWare API (mock providers).

This script is intentionally lightweight and **not** wired into CI. It is
meant for manual use by operators to exercise the end-to-end pipeline in
mock mode and capture basic latency stats.

Usage (from repo root, local stack running):

    PROV9DERS_MODE=mock API_BASE_URL=http://localhost:8080 \
        python scripts/perf/run_load_test.py --project test_video_gen --runs 50 --concurrency 5

The script only issues `/v1/runs/start` requests and prints naive p50/p95/p99
latencies. It does **not** call staging or production by default; the base URL
must be explicitly configured via environment variables or flags.
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import time
from typing import Any

import httpx


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lightweight load test for MyloWare runs API (mock mode only)")
    parser.add_argument("--base-url", default="http://localhost:8080", help="API base URL (default: http://localhost:8080)")
    parser.add_argument("--project", default="test_video_gen", choices=["test_video_gen", "aismr"], help="Project to exercise")
    parser.add_argument("--runs", type=int, default=20, help="Total number of runs to start (default: 20)")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of concurrent requests (default: 5)")
    parser.add_argument("--api-key", default=None, help="x-api-key header (defaults to API_KEY env if unset)")
    return parser.parse_args()


async def _start_run(client: httpx.AsyncClient, base_url: str, project: str, api_key: str | None) -> float:
    payload: dict[str, Any] = {
        "project": project,
        "input": {"prompt": "Load test run"},
        "options": {},
    }
    headers = {"x-api-key": api_key} if api_key else {}
    start = time.perf_counter()
    response = await client.post(f"{base_url}/v1/runs/start", json=payload, headers=headers, timeout=30.0)
    elapsed = time.perf_counter() - start
    response.raise_for_status()
    return elapsed


async def _run_load_test(base_url: str, project: str, runs: int, concurrency: int, api_key: str | None) -> None:
    limits = httpx.Limits(max_keepalive_connections=concurrency, max_connections=concurrency)
    async with httpx.AsyncClient(limits=limits) as client:
        latencies: list[float] = []

        sem = asyncio.Semaphore(concurrency)

        async def _runner(idx: int) -> None:
            async with sem:
                latency = await _start_run(client, base_url, project, api_key)
                latencies.append(latency)
                print(f"run {idx+1}/{runs}: {latency * 1000:.1f} ms")

        tasks = [asyncio.create_task(_runner(i)) for i in range(runs)]
        await asyncio.gather(*tasks)

    if not latencies:
        print("no runs executed")
        return

    latencies_ms = sorted(x * 1000.0 for x in latencies)
    p50 = statistics.median(latencies_ms)
    p95 = latencies_ms[int(0.95 * (len(latencies_ms) - 1))]
    p99 = latencies_ms[int(0.99 * (len(latencies_ms) - 1))]
    print("\nLatency summary (ms):")
    print(f"  p50={p50:.1f}  p95={p95:.1f}  p99={p99:.1f}")


def main() -> int:
    args = _parse_args()
    api_key = args.api_key or None
    try:
        asyncio.run(_run_load_test(args.base_url.rstrip("/"), args.project, args.runs, args.concurrency, api_key))
    except httpx.HTTPError as exc:
        print(f"load test failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - manual script
    raise SystemExit(main())

