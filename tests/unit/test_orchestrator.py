"""Unit tests for workflow orchestrator."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from storage.models import Base, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.orchestrator import (
    run_workflow,
    continue_after_ideation,
    continue_after_publish_approval,
)


class FakeCompletionMessage:
    def __init__(self, content: str):
        self.content = content


class FakeResponse:
    def __init__(self, content: str):
        self.completion_message = FakeCompletionMessage(content)


class FakeAgent:
    def __init__(self, content: str):
        self._content = content

    def create_session(self, *_args, **_kwargs):
        return "session-id"

    def create_turn(self, *args, **kwargs):  # pragma: no cover - parameters unused
        return FakeResponse(self._content)


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def repo(session):
    return RunRepository(session)


@pytest.fixture
def artifact_repo(session):
    return ArtifactRepository(session)


def _patch_create_agent(monkeypatch, fake_fn):
    """Patch create_agent in all step modules."""
    monkeypatch.setattr("workflows.steps.ideation.create_agent", fake_fn)
    monkeypatch.setattr("workflows.steps.production.create_agent", fake_fn)
    monkeypatch.setattr("workflows.steps.publishing.create_agent", fake_fn)


def test_run_workflow_success(monkeypatch, repo, artifact_repo):
    """Test successful workflow execution through all stages."""

    def fake_create_agent(client, project, role, vector_db_id=None, run_id=None):
        """Return a fake agent that produces role-specific output."""
        return FakeAgent(f"{role} output")

    _patch_create_agent(monkeypatch, fake_create_agent)

    result = run_workflow(
        client=None, brief="test", vector_db_id="kb", run_repo=repo, artifact_repo=artifact_repo
    )

    assert result.status == RunStatus.AWAITING_IDEATION_APPROVAL

    # continue after approval - now waits for video generation (webhook-driven)
    mid = continue_after_ideation(
        client=None,
        run_id=result.run_id,
        vector_db_id="kb",
        run_repo=repo,
        artifact_repo=artifact_repo,
    )

    # After ideation approval, producer submits to KIE.ai and waits for webhooks
    assert mid.status == RunStatus.AWAITING_VIDEO_GENERATION

    # Simulate webhook stages completing (KIE.ai → Remotion → publish approval)
    # Add video artifact that would be created by Remotion webhook
    from storage.models import ArtifactType
    artifact_repo.create(
        run_id=result.run_id,
        persona="editor",
        artifact_type=ArtifactType.RENDERED_VIDEO,
        uri="https://example.com/video.mp4",
        metadata={"step": "editor"},
    )
    repo.update(result.run_id, status=RunStatus.AWAITING_PUBLISH_APPROVAL.value)
    repo.session.commit()

    final = continue_after_publish_approval(
        client=None,
        run_id=result.run_id,
        vector_db_id="kb",
        run_repo=repo,
        artifact_repo=artifact_repo,
    )

    assert final.status == RunStatus.COMPLETED
    stored = repo.get(result.run_id)
    assert stored.status == RunStatus.COMPLETED.value


def test_run_workflow_failure(monkeypatch, repo, artifact_repo):
    """Test workflow failure handling at producer stage."""

    call_count = {"producer": 0}

    def fake_create_agent(client, project, role, vector_db_id=None, run_id=None):
        """Return a fake agent that fails on producer."""
        if role == "producer":
            call_count["producer"] += 1
            raise RuntimeError("boom")
        return FakeAgent(f"{role} output")

    _patch_create_agent(monkeypatch, fake_create_agent)

    result = run_workflow(
        client=None, brief="test", vector_db_id="kb", run_repo=repo, artifact_repo=artifact_repo
    )

    # approval step triggers failure on producer
    mid = continue_after_ideation(
        client=None,
        run_id=result.run_id,
        vector_db_id="kb",
        run_repo=repo,
        artifact_repo=artifact_repo,
    )

    assert mid.status == RunStatus.FAILED
    stored = repo.get(result.run_id)
    assert stored.status == RunStatus.FAILED.value
