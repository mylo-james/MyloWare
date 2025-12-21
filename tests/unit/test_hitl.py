"""Unit tests for HITL gate handling."""

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from myloware.storage.models import RunStatus
from myloware.workflows.hitl import (
    GATE_IDEATION,
    GATE_PUBLISH,
    GATE_STATUS_MAP,
    GateApprovalContext,
    approve_gate,
    reject_gate,
)
from myloware.workflows.state import WorkflowResult


def test_gate_constants():
    """Test gate constants."""
    assert GATE_IDEATION == "ideation"
    assert GATE_PUBLISH == "publish"


def test_gate_status_map():
    """Test GATE_STATUS_MAP mapping."""
    assert GATE_STATUS_MAP[GATE_IDEATION] == RunStatus.AWAITING_IDEATION_APPROVAL
    assert GATE_STATUS_MAP[GATE_PUBLISH] == RunStatus.AWAITING_PUBLISH_APPROVAL


def test_gate_approval_context():
    """Test GateApprovalContext dataclass."""
    mock_client = Mock()
    run_id = uuid4()
    mock_repo = Mock()
    mock_artifact_repo = Mock()

    context = GateApprovalContext(
        client=mock_client,
        run_id=run_id,
        gate=GATE_IDEATION,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        vector_db_id="vs_123",
        content_override="override",
    )

    assert context.client == mock_client
    assert context.run_id == run_id
    assert context.gate == GATE_IDEATION
    assert context.content_override == "override"
    assert context.vector_db_id == "vs_123"


@patch("myloware.workflows.hitl.log_hitl_event")
@patch("myloware.workflows.hitl.log_audit_event")
def test_approve_gate_ideation_with_context(mock_audit, mock_telemetry):
    """Test approve_gate for ideation gate using context."""
    mock_client = Mock()
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.AWAITING_IDEATION_APPROVAL.value
    mock_run.user_id = "user_123"
    mock_run.artifacts = {"ideas": "original ideas"}

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    context = GateApprovalContext(
        client=mock_client,
        run_id=run_id,
        gate=GATE_IDEATION,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        vector_db_id="vs_123",
        content_override="new ideas",
    )

    # Pass context as keyword argument along with required positional args
    result = approve_gate(
        client=mock_client,
        run_id=run_id,
        gate=GATE_IDEATION,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        vector_db_id="vs_123",
        context=context,
    )

    assert isinstance(result, WorkflowResult)
    assert result.run_id == str(run_id)
    assert result.status == RunStatus.AWAITING_IDEATION_APPROVAL.value
    mock_repo.add_artifact.assert_called()
    mock_audit.assert_called_once()
    mock_telemetry.assert_called_once()


@patch("myloware.workflows.hitl.log_hitl_event")
@patch("myloware.workflows.hitl.log_audit_event")
def test_approve_gate_ideation_without_override(mock_audit, mock_telemetry):
    """Test approve_gate for ideation gate without content override."""
    mock_client = Mock()
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.AWAITING_IDEATION_APPROVAL.value
    mock_run.user_id = "user_123"
    mock_run.artifacts = {"ideas": "original ideas"}

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    result = approve_gate(
        client=mock_client,
        run_id=run_id,
        gate=GATE_IDEATION,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        vector_db_id="vs_123",
    )

    assert isinstance(result, WorkflowResult)
    # Should not add artifacts when no override
    assert mock_repo.add_artifact.call_count == 0


@patch("myloware.workflows.hitl.log_hitl_event")
@patch("myloware.workflows.hitl.log_audit_event")
def test_approve_gate_publish(mock_audit, mock_telemetry):
    """Test approve_gate for publish gate."""
    mock_client = Mock()
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.AWAITING_PUBLISH_APPROVAL.value
    mock_run.user_id = "user_123"
    mock_run.artifacts = {}

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    result = approve_gate(
        client=mock_client,
        run_id=run_id,
        gate=GATE_PUBLISH,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        vector_db_id="vs_123",
        content_override="new publish content",
    )

    assert isinstance(result, WorkflowResult)
    assert result.status == RunStatus.AWAITING_PUBLISH_APPROVAL.value
    mock_repo.add_artifact.assert_called_once_with(
        run_id, "publish_override", "new publish content"
    )


def test_approve_gate_run_not_found():
    """Test approve_gate raises error when run not found."""
    mock_client = Mock()
    run_id = uuid4()
    mock_repo = Mock()
    mock_repo.get.return_value = None
    mock_artifact_repo = Mock()

    with pytest.raises(ValueError, match="not found"):
        approve_gate(
            client=mock_client,
            run_id=run_id,
            gate=GATE_IDEATION,
            run_repo=mock_repo,
            artifact_repo=mock_artifact_repo,
            vector_db_id="vs_123",
        )


def test_approve_gate_unknown_gate():
    """Test approve_gate raises error for unknown gate."""
    mock_client = Mock()
    run_id = uuid4()
    mock_run = Mock()
    mock_run.status = RunStatus.PENDING.value

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    with pytest.raises(ValueError, match="Unknown gate"):
        approve_gate(
            client=mock_client,
            run_id=run_id,
            gate="unknown_gate",
            run_repo=mock_repo,
            artifact_repo=mock_artifact_repo,
            vector_db_id="vs_123",
        )


@patch("myloware.workflows.hitl.log_hitl_event")
@patch("myloware.workflows.hitl.log_audit_event")
def test_approve_gate_unhandled_gate_raises(mock_audit, mock_telemetry, monkeypatch):
    """Test approve_gate raises for future gates missing a handler."""
    mock_client = Mock()
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.AWAITING_IDEATION_APPROVAL.value
    mock_run.user_id = "user_123"
    mock_run.artifacts = {}

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    monkeypatch.setitem(GATE_STATUS_MAP, "future_gate", RunStatus.AWAITING_IDEATION_APPROVAL)

    with pytest.raises(ValueError, match="Unhandled gate"):
        approve_gate(
            client=mock_client,
            run_id=run_id,
            gate="future_gate",
            run_repo=mock_repo,
            artifact_repo=mock_artifact_repo,
            vector_db_id="vs_123",
        )

    mock_audit.assert_called_once()
    mock_telemetry.assert_called_once()


@patch("myloware.config.settings")
def test_approve_gate_wrong_status_fake_providers(mock_settings):
    """Test approve_gate allows wrong status in test mode."""
    mock_settings.disable_background_workflows = True
    mock_client = Mock()
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.PENDING.value  # Wrong status
    mock_run.user_id = "user_123"
    mock_run.artifacts = {}

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    # Should not raise in test mode (status checks relaxed)
    result = approve_gate(
        client=mock_client,
        run_id=run_id,
        gate=GATE_IDEATION,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        vector_db_id="vs_123",
    )

    assert isinstance(result, WorkflowResult)


@patch("myloware.config.settings")
def test_approve_gate_wrong_status_real_providers(mock_settings):
    """Test approve_gate raises error for wrong status with real providers."""
    mock_settings.disable_background_workflows = False
    mock_client = Mock()
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.PENDING.value  # Wrong status

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    with pytest.raises(ValueError, match="does not match expected"):
        approve_gate(
            client=mock_client,
            run_id=run_id,
            gate=GATE_IDEATION,
            run_repo=mock_repo,
            artifact_repo=mock_artifact_repo,
            vector_db_id="vs_123",
        )


@patch("myloware.workflows.hitl.log_audit_event")
@patch("myloware.workflows.helpers.notify_telegram")
def test_reject_gate(mock_notify, mock_audit):
    """Test reject_gate."""
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.AWAITING_IDEATION_APPROVAL.value
    mock_run.user_id = "user_123"
    mock_run.artifacts = {}

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()
    mock_notifier = Mock()

    result = reject_gate(
        run_id=run_id,
        gate=GATE_IDEATION,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        reason="Not good enough",
        notifier=mock_notifier,
    )

    assert isinstance(result, WorkflowResult)
    assert result.status == RunStatus.REJECTED.value
    assert result.error == "Not good enough"
    mock_repo.update_status.assert_called_once_with(run_id, RunStatus.REJECTED)
    mock_repo.update_step.assert_called_once_with(run_id, GATE_IDEATION)
    mock_repo.add_artifact.assert_called()
    mock_artifact_repo.create.assert_called_once()
    mock_audit.assert_called_once()
    mock_notify.assert_called_once()


def test_reject_gate_run_not_found():
    """Test reject_gate raises error when run not found."""
    run_id = uuid4()
    mock_repo = Mock()
    mock_repo.get.return_value = None
    mock_artifact_repo = Mock()

    with pytest.raises(ValueError, match="not found"):
        reject_gate(
            run_id=run_id,
            gate=GATE_IDEATION,
            run_repo=mock_repo,
            artifact_repo=mock_artifact_repo,
        )


def test_reject_gate_unknown_gate():
    """Test reject_gate raises error for unknown gate."""
    run_id = uuid4()
    mock_run = Mock()
    mock_run.status = RunStatus.PENDING.value

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    with pytest.raises(ValueError, match="Unknown gate"):
        reject_gate(
            run_id=run_id,
            gate="unknown_gate",
            run_repo=mock_repo,
            artifact_repo=mock_artifact_repo,
        )


@patch("myloware.config.settings")
def test_reject_gate_wrong_status_fake_providers(mock_settings):
    """Test reject_gate allows wrong status in test mode."""
    mock_settings.disable_background_workflows = True
    run_id = uuid4()
    mock_run = Mock()
    mock_run.status = RunStatus.PENDING.value  # Wrong status

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    result = reject_gate(
        run_id=run_id,
        gate=GATE_IDEATION,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
    )

    assert isinstance(result, WorkflowResult)


@patch("myloware.config.settings")
def test_reject_gate_wrong_status_real_providers(mock_settings):
    """Test reject_gate raises error for wrong status with real providers."""
    mock_settings.disable_background_workflows = False
    run_id = uuid4()
    mock_run = Mock()
    mock_run.status = RunStatus.PENDING.value  # Wrong status

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    with pytest.raises(ValueError, match="does not match expected"):
        reject_gate(
            run_id=run_id,
            gate=GATE_IDEATION,
            run_repo=mock_repo,
            artifact_repo=mock_artifact_repo,
        )


@patch("myloware.workflows.hitl.log_audit_event")
def test_reject_gate_no_notifier(mock_audit):
    """Test reject_gate without notifier."""
    run_id = uuid4()
    mock_run = Mock()
    mock_run.id = run_id
    mock_run.status = RunStatus.AWAITING_PUBLISH_APPROVAL.value
    mock_run.user_id = "user_123"
    mock_run.artifacts = {}

    mock_repo = Mock()
    mock_repo.get.return_value = mock_run
    mock_artifact_repo = Mock()

    result = reject_gate(
        run_id=run_id,
        gate=GATE_PUBLISH,
        run_repo=mock_repo,
        artifact_repo=mock_artifact_repo,
        reason="Rejected",
        notifier=None,
    )

    assert isinstance(result, WorkflowResult)
    assert result.status == RunStatus.REJECTED.value
