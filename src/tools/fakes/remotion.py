"""Deterministic Remotion fake client for testing."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

__all__ = ["RemotionFakeClient"]


@dataclass
class RemotionFakeClient:
    """Fake Remotion client returning predictable responses."""

    jobs: List[Dict[str, Any]] = field(default_factory=list)

    def submit(
        self,
        *,
        composition_code: str,
        clips: List[str],
        run_id: str | None,
        duration_frames: int,
    ) -> Dict[str, Any]:
        job_id = f"fake-remotion-{len(self.jobs)}"
        record = {
            "job_id": job_id,
            "composition_code": composition_code,
            "clips": clips,
            "run_id": run_id,
            "duration_frames": duration_frames,
        }
        self.jobs.append(record)
        return {
            "job_id": job_id,
            "status": "queued",
            "output_url": f"https://fake.remotion/{job_id}.mp4",
        }
