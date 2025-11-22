"""Canonical supervisor graph that re-exports Brendan's graph compiler."""
from __future__ import annotations

from ..brendan_graph import compile_brendan_graph as compile_supervisor_graph

__all__ = ["compile_supervisor_graph"]

