"""Job type constants and idempotency helpers."""

from __future__ import annotations

from uuid import UUID

JOB_RUN_EXECUTE = "run.execute"
JOB_SORA_POLL = "sora.poll"
JOB_REMOTION_POLL = "remotion.poll"
JOB_WEBHOOK_SORA = "webhook.sora"
JOB_WEBHOOK_REMOTION = "webhook.remotion"
JOB_LANGGRAPH_RESUME_VIDEOS = "langgraph.resume_after_videos"
JOB_LANGGRAPH_RESUME_RENDER = "langgraph.resume_after_render"
JOB_LANGGRAPH_RESUME = "langgraph.resume"
JOB_LANGGRAPH_HITL_RESUME = "langgraph.hitl_resume"


def idempotency_run_execute(run_id: UUID) -> str:
    return f"run_execute:{run_id}"


def idempotency_sora_poll(run_id: UUID) -> str:
    return f"sora_poll:{run_id}"


def idempotency_remotion_poll(run_id: UUID, render_job_id: str) -> str:
    return f"remotion_poll:{run_id}:{render_job_id}"


def idempotency_sora_webhook(run_id: UUID, task_id: str | None) -> str | None:
    if not task_id:
        return None
    return f"sora:{run_id}:{task_id}"


def idempotency_remotion_webhook(run_id: UUID, job_id: str | None) -> str | None:
    if not job_id:
        return None
    return f"remotion:{run_id}:{job_id}"


def idempotency_resume_videos(run_id: UUID) -> str:
    return f"resume_videos:{run_id}"


def idempotency_resume_render(run_id: UUID) -> str:
    return f"resume_render:{run_id}"


def idempotency_langgraph_resume(
    run_id: UUID, interrupt_id: str | None, resume_data_hash: str
) -> str:
    intr = interrupt_id or "none"
    return f"lg_resume:{run_id}:{intr}:{resume_data_hash}"
