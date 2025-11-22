"""API service Prometheus metrics."""
from __future__ import annotations


from prometheus_client import Counter


webhook_verify_total = Counter(
    "webhook_verify_total",
    "Webhook signature verification results by provider and status",
    ["provider", "status"],
)

__all__ = ["webhook_verify_total"]
