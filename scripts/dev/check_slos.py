#!/usr/bin/env python3
"""SLO guardrail script for Brendan-first pipelines."""
from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

import httpx
from prometheus_client.parser import text_string_to_metric_families

PROJECT_PROMPTS = {
    "test_video_gen": "Run Test Video Gen about neon postcards",
    "aismr": "Create an AISMR surreal candle study",
}

DEFAULT_PROJECTS = tuple(PROJECT_PROMPTS.keys())
GATE_SEQUENCE = ("workflow", "ideate", "prepublish")
DEFAULT_TIMEOUT = 60.0
METRICS_ENDPOINT_SUFFIX = "/metrics"


@dataclass(slots=True)
class HistogramSeries:
    labels: dict[str, str]
    buckets: dict[float, float] = field(default_factory=dict)
    count: float | None = None
    total_sum: float | None = None

    def add_bucket(self, upper_bound: float, value: float) -> None:
        self.buckets[upper_bound] = value

    def quantile(self, percentile: float) -> float | None:
        if not self.buckets:
            return None
        total = self.count if self.count is not None else max(self.buckets.values())
        if total <= 0:
            return 0.0
        target = total * percentile
        prev_le = 0.0
        prev_count = 0.0
        for upper_bound in sorted(self.buckets):
            count = self.buckets[upper_bound]
            if count >= target:
                if count == prev_count:
                    return upper_bound
                fraction = (target - prev_count) / (count - prev_count)
                span = upper_bound - prev_le if upper_bound != float("inf") else 0.0
                return prev_le + fraction * span
            prev_le = upper_bound
            prev_count = count
        return float("inf")


class MetricsStore:
    """Accumulator for Prometheus metrics scraped from multiple endpoints."""

    def __init__(self) -> None:
        self._histograms: dict[str, dict[tuple[tuple[str, str], ...], HistogramSeries]] = {}

    def ingest_metrics(self, payload: str) -> None:
        for family in text_string_to_metric_families(payload):
            for sample in family.samples:
                name = sample.name
                labels = dict(sample.labels)
                value = float(sample.value)
                self._add_sample(name, labels, value)

    def _add_sample(self, name: str, labels: dict[str, str], value: float) -> None:
        if name.endswith("_bucket"):
            base = name[:-7]
            le_value = labels.pop("le", "+Inf")
            upper = float("inf") if le_value in {"+Inf", "Inf", "inf"} else float(le_value)
            series = self._get_or_create_series(base, labels)
            series.add_bucket(upper, value)
        elif name.endswith("_count"):
            base = name[:-6]
            series = self._get_or_create_series(base, labels)
            series.count = value
        elif name.endswith("_sum"):
            base = name[:-4]
            series = self._get_or_create_series(base, labels)
            series.total_sum = value

    def _get_or_create_series(self, base: str, labels: Mapping[str, str]) -> HistogramSeries:
        base_bucket = self._histograms.setdefault(base, {})
        key = tuple(sorted(labels.items()))
        if key not in base_bucket:
            base_bucket[key] = HistogramSeries(labels=dict(labels))
        return base_bucket[key]

    def find_histogram(self, metric: str, label_filter: Mapping[str, str]) -> HistogramSeries | None:
        candidates = []
        for series in self._histograms.get(metric, {}).values():
            if all(series.labels.get(k) == v for k, v in label_filter.items()):
                candidates.append(series)
        if not candidates:
            return None
        candidates.sort(key=lambda item: item.count or 0.0, reverse=True)
        return candidates[0]


@dataclass(slots=True)
class SLOTarget:
    name: str
    metric: str
    quantile: float
    threshold: float
    label_options: Sequence[dict[str, str]]
    unit: str = "seconds"

    def candidate_labels(self) -> Sequence[dict[str, str]]:
        return self.label_options or [{}]


@dataclass(slots=True)
class SLOResult:
    target: SLOTarget
    observed: float | None
    passed: bool
    message: str


def evaluate_slo_targets(store: MetricsStore, targets: Sequence[SLOTarget]) -> list[SLOResult]:
    results: list[SLOResult] = []
    for target in targets:
        series: HistogramSeries | None = None
        for labels in target.candidate_labels():
            series = store.find_histogram(target.metric, labels)
            if series:
                break
        if not series:
            results.append(
                SLOResult(
                    target=target,
                    observed=None,
                    passed=False,
                    message=f"Missing metric '{target.metric}' for labels {target.candidate_labels()}",
                )
            )
            continue
        observed = series.quantile(target.quantile)
        if observed is None or observed == float("inf"):
            results.append(
                SLOResult(
                    target=target,
                    observed=None,
                    passed=False,
                    message="Insufficient histogram buckets to compute quantile",
                )
            )
            continue
        passed = observed <= target.threshold
        comparison = "passes" if passed else "exceeds"
        message = (
            f"{target.name} {comparison} target ({observed:.3f} {target.unit} vs {target.threshold:.3f} {target.unit})"
        )
        results.append(SLOResult(target=target, observed=observed, passed=passed, message=message))
    return results


SLO_TARGETS: tuple[SLOTarget, ...] = (
    SLOTarget(
        name="Chat p95 < 2s",
        metric="http_request_duration_seconds",
        quantile=0.95,
        threshold=2.0,
        label_options=[
            {"handler": "/v1/chat/brendan"},
            {"path": "/v1/chat/brendan"},
        ],
    ),
    SLOTarget(
        name="Retrieval p95 < 0.5s",
        metric="kb_search_seconds",
        quantile=0.95,
        threshold=0.5,
        label_options=[{}, {"project": "aismr"}],
    ),
    SLOTarget(
        name="Mock publish p95 < 30s",
        metric="mock_publish_seconds",
        quantile=0.95,
        threshold=30.0,
        label_options=[{}],
    ),
)


def _ensure_response(response: httpx.Response, context: str) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:  # pragma: no cover - network error path
        raise RuntimeError(f"{context} failed: {exc.response.status_code} {exc.response.text}") from exc


def _start_brendan_run(client: httpx.Client, project: str, api_key: str) -> str:
    prompt = PROJECT_PROMPTS[project]
    payload = {"user_id": f"slo-{project}", "message": prompt}
    response = client.post("/v1/chat/brendan", json=payload, headers={"x-api-key": api_key})
    _ensure_response(response, "chat" )
    data = response.json()
    run_ids = data.get("run_ids") or []
    if not run_ids:
        raise RuntimeError("Brendan response missing run_ids")
    return run_ids[0]


def _fetch_run(client: httpx.Client, api_key: str, run_id: str) -> dict[str, Any]:
    response = client.get(f"/v1/runs/{run_id}", headers={"x-api-key": api_key})
    _ensure_response(response, f"runs/{run_id}")
    return response.json()


def _wait_for_gate(client: httpx.Client, api_key: str, run_id: str, gate: str, timeout: float = DEFAULT_TIMEOUT) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run_state = _fetch_run(client, api_key, run_id)
        artifacts = run_state.get("artifacts") or []
        for artifact in artifacts:
            metadata = artifact.get("metadata") or {}
            if artifact.get("type") == "hitl.request" and metadata.get("gate") == gate:
                return
        time.sleep(1.0)
    raise TimeoutError(f"Timed out waiting for {gate} gate on {run_id}")


def _approve_gate(client: httpx.Client, api_key: str, run_id: str, gate: str) -> None:
    response = client.get(
        f"/v1/hitl/approve/{run_id}/{gate}",
        headers={"x-api-key": api_key},
        params={},
    )
    _ensure_response(response, f"approve {gate}")


def _wait_for_completion(client: httpx.Client, api_key: str, run_id: str, timeout: float = DEFAULT_TIMEOUT) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run_state = _fetch_run(client, api_key, run_id)
        status = str(run_state.get("status") or "").lower()
        if status == "published":
            return
        time.sleep(2.0)
    raise TimeoutError(f"Run {run_id} did not complete within {timeout} seconds")


def run_project_flow(client: httpx.Client, api_key: str, project: str, gate_timeout: float = DEFAULT_TIMEOUT) -> str:
    run_id = _start_brendan_run(client, project, api_key)
    for gate in GATE_SEQUENCE:
        _wait_for_gate(client, api_key, run_id, gate, timeout=gate_timeout)
        _approve_gate(client, api_key, run_id, gate)
    _wait_for_completion(client, api_key, run_id, timeout=gate_timeout)
    return run_id


def _scrape_metrics(endpoints: Iterable[str]) -> MetricsStore:
    store = MetricsStore()
    with httpx.Client(timeout=10.0) as client:
        for endpoint in endpoints:
            response = client.get(endpoint)
            _ensure_response(response, endpoint)
            store.ingest_metrics(response.text)
    return store


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Brendan flows and check SLOs")
    parser.add_argument("--api-base", default=os.getenv("API_BASE", "http://localhost:8080"))
    parser.add_argument("--orchestrator-base", default=os.getenv("ORCHESTRATOR_BASE", "http://localhost:8090"))
    parser.add_argument("--api-key", default=os.getenv("API_KEY"), help="API key for authenticated endpoints")
    parser.add_argument(
        "--projects",
        default=",".join(DEFAULT_PROJECTS),
        help="Comma-separated list of projects to exercise",
    )
    parser.add_argument("--skip-flows", action="store_true", help="Skip triggering new runs; only scrape metrics")
    parser.add_argument("--metrics-only", action="store_true", help="Alias for --skip-flows")
    parser.add_argument("--gate-timeout", type=float, default=DEFAULT_TIMEOUT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    api_key = args.api_key
    if not api_key:
        print("API key required via --api-key or API_KEY env", file=sys.stderr)
        return 2
    projects = [item.strip() for item in args.projects.split(",") if item.strip()]
    invalid = [project for project in projects if project not in PROJECT_PROMPTS]
    if invalid:
        print(f"Unsupported projects: {', '.join(invalid)}", file=sys.stderr)
        return 2

    skip_flows = args.skip_flows or args.metrics_only
    if not skip_flows:
        with httpx.Client(base_url=args.api_base, timeout=args.gate_timeout) as client:
            for project in projects:
                print(f"▶ Running {project} via Brendan…")
                try:
                    run_id = run_project_flow(client, api_key, project, gate_timeout=args.gate_timeout)
                except Exception as exc:  # pragma: no cover - runtime path
                    print(f"✗ {project} run failed: {exc}", file=sys.stderr)
                    return 1
                print(f"✓ {project} run completed (run_id={run_id})")

    metric_endpoints = [args.api_base.rstrip("/") + METRICS_ENDPOINT_SUFFIX]
    if args.orchestrator_base:
        metric_endpoints.append(args.orchestrator_base.rstrip("/") + METRICS_ENDPOINT_SUFFIX)

    try:
        store = _scrape_metrics(metric_endpoints)
    except Exception as exc:  # pragma: no cover - runtime path
        print(f"Failed to scrape metrics: {exc}", file=sys.stderr)
        return 1

    results = evaluate_slo_targets(store, SLO_TARGETS)
    ok = True
    for result in results:
        status = "PASS" if result.passed else "FAIL"
        observed = "n/a" if result.observed is None else f"{result.observed:.3f}"
        print(f"[{status}] {result.target.name}: observed={observed} {result.target.unit} :: {result.message}")
        ok = ok and result.passed
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
