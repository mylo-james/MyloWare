"""Prometheus metrics for the orchestrator service."""
from __future__ import annotations


from prometheus_client import Counter


adapter_calls_total = Counter(
    "adapter_calls_total",
    "Persona adapter calls by provider and providers_mode",
    ["provider", "mode"],
)

persona_allowlist_failures_total = Counter(
    "persona_allowlist_failures_total",
    "Persona tool allowlist failures (no tools or invalid configuration)",
    ["persona", "project", "mode"],
)

__all__ = ["adapter_calls_total", "persona_allowlist_failures_total"]
