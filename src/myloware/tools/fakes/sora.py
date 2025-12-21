"""Deterministic Sora fake client for testing."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

__all__ = ["SoraFakeClient"]


@dataclass
class SoraFakeClient:
    """Fake Sora client that returns deterministic responses."""

    submitted_jobs: List[Dict[str, Any]] = field(default_factory=list)

    def submit_job(
        self,
        *,
        prompt: str,
        run_id: str,
        callback_url: str,
        duration: int = 5,
        aspect_ratio: str = "9:16",
        quality: str = "standard",
        model: str = "sora-fake",
        metadata: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        job_id = f"fake-sora-{len(self.submitted_jobs)}"
        job = {
            "prompt": prompt,
            "run_id": run_id,
            "callback_url": callback_url,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "quality": quality,
            "model": model,
            "metadata": metadata or {},
            "job_id": job_id,
        }
        self.submitted_jobs.append(job)

        return {
            "status": "submitted",
            "data": {
                "taskId": job_id,
                "status": "submitted",
                "videoUrl": None,
                "metadata": {"runId": run_id, **(metadata or {})},
            },
        }

    def simulate_callback(self, job_id: str) -> Dict[str, Any]:
        """Generate a deterministic callback payload."""

        matching = next((j for j in self.submitted_jobs if j["job_id"] == job_id), None)
        metadata = matching.get("metadata", {}) if matching else {}
        run_id = metadata.get("runId") or metadata.get("run_id")
        if not run_id and matching:
            run_id = matching.get("run_id")

        return {
            "taskId": job_id,
            "status": "completed",
            "videoUrl": f"https://fake.sora.openai/{job_id}.mp4",
            "metadata": {"runId": run_id},
        }
