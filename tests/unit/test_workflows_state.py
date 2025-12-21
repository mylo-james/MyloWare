from __future__ import annotations

from myloware.workflows.state import WorkflowResult


def test_workflow_result_properties():
    result = WorkflowResult(run_id="r1", status="completed")
    assert result.is_success is True
    assert result.is_failed is False
    assert result.is_awaiting_approval is False

    awaiting = WorkflowResult(run_id="r1", status="awaiting_publish_approval")
    assert awaiting.is_awaiting_approval is True


def test_workflow_result_factories():
    success = WorkflowResult.success(
        run_id="r2",
        status="completed",
        artifacts={"video": "url"},
        current_step="publisher",
    )
    assert success.is_success is True

    failure = WorkflowResult.failure(run_id="r3", error="boom")
    assert failure.is_failed is True
