"""Canonical supervisor agent that re-exports Brendan's implementation."""
from __future__ import annotations

from ..brendan_agent import run_brendan_agent as run_supervisor_agent

__all__ = ["run_supervisor_agent"]

