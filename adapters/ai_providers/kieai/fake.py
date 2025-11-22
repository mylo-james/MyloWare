"""Deterministic kie.ai fake adapter for mock runs."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class KieAIFakeClient:
    """Minimal stand-in for KieAIClient with deterministic outputs."""

    submitted_jobs: List[Dict[str, Any]] = field(default_factory=list)

    def submit_job(
        self,
        *,
        prompt: str,
        run_id: str,
        callback_url: str,
        duration: int,
        aspect_ratio: str,
        quality: str,
        model: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        meta = {"runId": run_id, **(metadata or {})}
        video_index = meta.get("videoIndex", 0)
        task_id = f"{run_id}-{video_index}"
        record = {
            "prompt": prompt,
            "run_id": run_id,
            "callback_url": callback_url,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "quality": quality,
            "model": model,
            "metadata": meta,
            "task_id": task_id,
        }
        self.submitted_jobs.append(record)
        return {
            "data": {
                "taskId": task_id,
                "metadata": meta,
                "prompt": prompt,
                "runId": run_id,
            }
        }

    def close(self) -> None:
        """Parity with real client."""
        return None
