"""Unit tests for audit logging functionality."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from myloware.storage.models import AuditLog, Base
from myloware.storage.repositories import AuditLogRepository


@pytest.fixture
def in_memory_session() -> Session:
    """Create an in-memory SQLite session for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    yield session
    session.close()
    engine.dispose()


class TestAuditLogModel:
    """Tests for the AuditLog model."""

    def test_audit_log_creation(self, in_memory_session: Session) -> None:
        """Test creating an AuditLog entry."""
        audit_log = AuditLog(
            action="workflow_started",
            user_id="user-123",
            run_id=uuid4(),
            duration_ms=1500,
            outcome="success",
            audit_metadata={"workflow_name": "test"},
        )
        in_memory_session.add(audit_log)
        in_memory_session.commit()

        assert audit_log.id is not None
        assert audit_log.action == "workflow_started"
        assert audit_log.user_id == "user-123"
        assert audit_log.outcome == "success"
        assert audit_log.audit_metadata == {"workflow_name": "test"}

    def test_audit_log_to_dict(self, in_memory_session: Session) -> None:
        """Test AuditLog to_dict method."""
        run_id = uuid4()
        audit_log = AuditLog(
            action="gate_approved",
            user_id="user-456",
            run_id=run_id,
            outcome="success",
            audit_metadata={"gate": "ideation"},
        )
        in_memory_session.add(audit_log)
        in_memory_session.commit()

        data = audit_log.to_dict()
        assert data["action"] == "gate_approved"
        assert data["user_id"] == "user-456"
        assert data["run_id"] == str(run_id)
        assert data["outcome"] == "success"
        assert data["metadata"] == {"gate": "ideation"}


class TestAuditLogRepository:
    """Tests for the AuditLogRepository."""

    def test_create_audit_log(self, in_memory_session: Session) -> None:
        """Test creating audit log via repository."""
        repo = AuditLogRepository(in_memory_session)
        run_id = uuid4()

        audit_log = repo.create(
            action="workflow_started",
            user_id="user-123",
            run_id=run_id,
            duration_ms=100,
            outcome="success",
            metadata={"test": "value"},
        )

        assert audit_log.id is not None
        assert audit_log.action == "workflow_started"
        assert audit_log.user_id == "user-123"
        assert audit_log.run_id == run_id

    def test_get_by_run_id(self, in_memory_session: Session) -> None:
        """Test querying audit logs by run_id."""
        repo = AuditLogRepository(in_memory_session)
        run_id = uuid4()

        # Create multiple logs for the same run
        repo.create(action="workflow_started", run_id=run_id)
        repo.create(action="gate_approved", run_id=run_id)
        repo.create(action="workflow_completed", run_id=run_id)
        in_memory_session.commit()

        logs = repo.get_by_run_id(run_id)
        assert len(logs) == 3
        assert logs[0].action == "workflow_started"
        assert logs[1].action == "gate_approved"
        assert logs[2].action == "workflow_completed"

    def test_get_by_user_id(self, in_memory_session: Session) -> None:
        """Test querying audit logs by user_id."""
        repo = AuditLogRepository(in_memory_session)
        user_id = "user-test"

        # Create multiple logs for the same user
        repo.create(action="workflow_started", user_id=user_id)
        repo.create(action="gate_approved", user_id=user_id)
        repo.create(action="workflow_started", user_id="other-user")
        in_memory_session.commit()

        logs = repo.get_by_user_id(user_id, limit=10)
        assert len(logs) == 2
        # Should be ordered by created_at desc (most recent first)
        assert all(log.user_id == user_id for log in logs)

    def test_get_by_user_id_with_limit(self, in_memory_session: Session) -> None:
        """Test limit parameter for user_id query."""
        repo = AuditLogRepository(in_memory_session)
        user_id = "user-limit-test"

        for i in range(5):
            repo.create(action=f"action_{i}", user_id=user_id)
        in_memory_session.commit()

        logs = repo.get_by_user_id(user_id, limit=3)
        assert len(logs) == 3


class TestAuditHelper:
    """Tests for the audit helper function."""

    def test_log_audit_event_success(self) -> None:
        """Test successful audit event logging."""
        with patch("myloware.observability.audit.get_session") as mock_get_session:
            mock_session = MagicMock()
            mock_get_session.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_get_session.return_value.__exit__ = MagicMock(return_value=False)

            from myloware.observability.audit import log_audit_event

            log_audit_event(
                action="test_action",
                user_id="user-123",
                outcome="success",
            )

            # Verify session was used
            mock_get_session.assert_called_once()

    def test_log_audit_event_failure_doesnt_propagate(self) -> None:
        """Test that audit failures don't block request processing."""
        with patch("myloware.observability.audit.get_session") as mock_get_session:
            mock_get_session.side_effect = Exception("Database error")

            from myloware.observability.audit import log_audit_event

            # Should not raise - failures are logged but not propagated
            log_audit_event(
                action="test_action",
                user_id="user-123",
                outcome="success",
            )
            # If we got here without exception, the test passes

    def test_log_audit_event_with_all_params(self) -> None:
        """Test audit event with all parameters."""
        with patch("myloware.observability.audit.get_session") as mock_get_session:
            mock_session = MagicMock()
            mock_get_session.return_value.__enter__ = MagicMock(return_value=mock_session)
            mock_get_session.return_value.__exit__ = MagicMock(return_value=False)

            from myloware.observability.audit import log_audit_event

            run_id = uuid4()
            log_audit_event(
                action="workflow_completed",
                user_id="user-456",
                run_id=run_id,
                duration_ms=5000,
                outcome="success",
                metadata={"workflow": "test", "steps": 3},
            )

            mock_get_session.assert_called_once()
