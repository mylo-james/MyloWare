"""Shotstack fake adapter."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class ShotstackFakeClient:
    """Deterministic fake Shotstack client used in mock mode."""

    renders: List[Dict[str, Any]] = field(default_factory=list)

    def render(self, timeline: dict[str, Any]) -> dict[str, Any]:
        meta = timeline.get("meta") if isinstance(timeline, dict) else None
        run_id = "run"
        if isinstance(meta, dict) and meta.get("runId"):
            run_id = str(meta["runId"])
        url = f"https://mock.video.myloware/{run_id}-final.mp4"
        job_id = f"{run_id}-job-{len(self.renders)}"
        record = {"timeline": timeline, "url": url, "job_id": job_id}
        self.renders.append(record)
        return {
            "url": url,
            "status": "done",
            "timeline": timeline,
            "id": job_id,
            "taskId": job_id,
        }

    def close(self) -> None:
        return None
