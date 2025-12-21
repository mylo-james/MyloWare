from __future__ import annotations

from uuid import uuid4

from myloware.workers import job_types


def test_idempotency_keys() -> None:
    run_id = uuid4()

    assert job_types.idempotency_run_execute(run_id).startswith("run_execute:")
    assert job_types.idempotency_resume_videos(run_id).startswith("resume_videos:")
    assert job_types.idempotency_resume_render(run_id).startswith("resume_render:")

    assert job_types.idempotency_sora_webhook(run_id, None) is None
    assert job_types.idempotency_sora_webhook(run_id, "t") == f"sora:{run_id}:t"

    assert job_types.idempotency_remotion_webhook(run_id, None) is None
    assert job_types.idempotency_remotion_webhook(run_id, "j") == f"remotion:{run_id}:j"

    assert job_types.idempotency_langgraph_resume(run_id, None, "h") == f"lg_resume:{run_id}:none:h"
    assert (
        job_types.idempotency_langgraph_resume(run_id, "intr", "h") == f"lg_resume:{run_id}:intr:h"
    )
