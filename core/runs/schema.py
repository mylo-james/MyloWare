"""Canonical run payload/result helpers."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence


@dataclass(slots=True)
class RunGraphSpec:
    """Describes the persona pipeline and HITL gates for a run."""

    pipeline: list[str] = field(default_factory=list)
    hitl_gates: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, list[str]]:
        return {"pipeline": self.pipeline, "hitl_gates": self.hitl_gates}


def _dedupe_preserve_order(items: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def build_graph_spec(*, pipeline: Sequence[str], hitl_gates: Sequence[str] | None = None) -> dict[str, list[str]]:
    """Return a canonical graph spec dict with deduplicated persona order + gates."""

    spec = RunGraphSpec(
        pipeline=_dedupe_preserve_order(pipeline),
        hitl_gates=_dedupe_preserve_order(hitl_gates or []),
    )
    return spec.to_dict()


def build_run_payload(
    *,
    project: str,
    run_input: Mapping[str, Any] | None,
    graph_spec: Mapping[str, Any],
    user_id: str | None = None,
    options: Mapping[str, Any] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Construct the canonical payload stored with every run."""

    payload: dict[str, Any] = {
        "project": project,
        "input": dict(run_input or {}),
        "graph_spec": dict(graph_spec),
        "user_id": user_id,
        "options": dict(options or {}),
        "metadata": dict(metadata or {}),
    }
    return payload


def build_run_result(
    *,
    status: str,
    publish_urls: Sequence[str] | None = None,
    artifacts: Sequence[Mapping[str, Any]] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Construct a normalized result block for `runs.result`."""

    return {
        "status": status,
        "publish_urls": list(publish_urls or []),
        "artifacts": [dict(artifact) for artifact in artifacts or []],
        "extra": dict(extra or {}),
    }
