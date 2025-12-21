"""Unit tests for feedback functionality."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from myloware.api.routes.feedback import FeedbackRequest
from myloware.storage.models import Base, Feedback, Run, RunStatus
from myloware.storage.repositories import FeedbackRepository, RunRepository


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


@pytest.fixture
def sample_run(in_memory_session: Session) -> Run:
    """Create a sample run for testing."""
    run_repo = RunRepository(in_memory_session)
    run = run_repo.create(
        workflow_name="test",
        input="Test input",
        status=RunStatus.COMPLETED,
    )
    in_memory_session.commit()
    return run


class TestFeedbackModel:
    """Tests for the Feedback model."""

    def test_feedback_creation(self, in_memory_session: Session, sample_run: Run) -> None:
        """Test creating a Feedback entry."""
        feedback = Feedback(
            run_id=sample_run.id,
            rating=5,
            comment="Great output!",
        )
        in_memory_session.add(feedback)
        in_memory_session.commit()

        assert feedback.id is not None
        assert feedback.run_id == sample_run.id
        assert feedback.rating == 5
        assert feedback.comment == "Great output!"
        assert feedback.artifact_id is None

    def test_feedback_to_dict(self, in_memory_session: Session, sample_run: Run) -> None:
        """Test Feedback to_dict method."""
        feedback = Feedback(
            run_id=sample_run.id,
            rating=1,
            comment="Not helpful",
        )
        in_memory_session.add(feedback)
        in_memory_session.commit()

        data = feedback.to_dict()
        assert data["run_id"] == str(sample_run.id)
        assert data["rating"] == 1
        assert data["comment"] == "Not helpful"
        assert data["artifact_id"] is None


class TestFeedbackRepository:
    """Tests for the FeedbackRepository."""

    def test_create_feedback(self, in_memory_session: Session, sample_run: Run) -> None:
        """Test creating feedback via repository."""
        repo = FeedbackRepository(in_memory_session)

        feedback = repo.create(
            run_id=sample_run.id,
            rating=5,
            comment="Excellent!",
        )

        assert feedback.id is not None
        assert feedback.run_id == sample_run.id
        assert feedback.rating == 5

    def test_create_feedback_with_artifact(
        self, in_memory_session: Session, sample_run: Run
    ) -> None:
        """Test creating feedback linked to an artifact."""
        repo = FeedbackRepository(in_memory_session)
        artifact_id = uuid4()

        feedback = repo.create(
            run_id=sample_run.id,
            rating=1,
            artifact_id=artifact_id,
            comment="The ideas were off-topic",
        )

        assert feedback.artifact_id == artifact_id
        assert feedback.comment == "The ideas were off-topic"

    def test_get_by_run_id(self, in_memory_session: Session, sample_run: Run) -> None:
        """Test getting feedback by run_id."""
        repo = FeedbackRepository(in_memory_session)

        # Create multiple feedback entries
        repo.create(run_id=sample_run.id, rating=5, comment="Good")
        repo.create(run_id=sample_run.id, rating=1, comment="Bad")
        in_memory_session.commit()

        feedback_list = repo.get_by_run_id(sample_run.id)

        assert len(feedback_list) == 2

    def test_get_by_run_id_empty(self, in_memory_session: Session) -> None:
        """Test getting feedback for run with no feedback."""
        repo = FeedbackRepository(in_memory_session)

        feedback_list = repo.get_by_run_id(uuid4())

        assert len(feedback_list) == 0

    def test_get_positive_feedback(self, in_memory_session: Session, sample_run: Run) -> None:
        """Test getting positive feedback for eval dataset."""
        repo = FeedbackRepository(in_memory_session)

        # Create mix of positive and negative feedback
        repo.create(run_id=sample_run.id, rating=5, comment="Great")
        repo.create(run_id=sample_run.id, rating=5, comment="Excellent")
        repo.create(run_id=sample_run.id, rating=1, comment="Poor")
        in_memory_session.commit()

        positive = repo.get_positive_feedback(limit=10)

        assert len(positive) == 2
        assert all(f.rating >= 4 for f in positive)

    def test_get_positive_feedback_limit(self, in_memory_session: Session, sample_run: Run) -> None:
        """Test limit parameter for positive feedback."""
        repo = FeedbackRepository(in_memory_session)

        # Create many positive entries
        for i in range(5):
            repo.create(run_id=sample_run.id, rating=5, comment=f"Good {i}")
        in_memory_session.commit()

        positive = repo.get_positive_feedback(limit=3)

        assert len(positive) == 3


class TestFeedbackValidation:
    """Tests for feedback rating validation."""

    def test_rating_one_is_valid(self) -> None:
        """Test that rating 1 is a valid thumbs-down."""
        request = FeedbackRequest(rating=1)
        assert request.rating == 1

    def test_rating_five_is_valid(self) -> None:
        """Test that rating 5 is a valid thumbs-up."""
        request = FeedbackRequest(rating=5)
        assert request.rating == 5

    def test_rating_three_is_invalid(self) -> None:
        """Test that rating 3 is rejected."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            FeedbackRequest(rating=3)

        assert "rating" in str(exc_info.value).lower()

    def test_rating_zero_is_invalid(self) -> None:
        """Test that rating 0 is rejected."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            FeedbackRequest(rating=0)

    def test_rating_ten_is_invalid(self) -> None:
        """Test that rating 10 is rejected."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            FeedbackRequest(rating=10)
