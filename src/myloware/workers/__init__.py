"""Worker utilities for scale-ready execution.

In production, API nodes enqueue durable jobs to Postgres and worker processes
claim and execute them.
"""

from __future__ import annotations

from myloware.workers.worker import run_worker

__all__ = ["run_worker"]
