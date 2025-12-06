"""Unit tests for HITL gate handling."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from storage.models import Base, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.hitl import approve_gate, reject_gate, GATE_IDEATION, GATE_PUBLISH
from workflows.orchestrator import run_workflow


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


def test_approve_ideation_gate(monkeypatch, repo, artifact_repo):
    """Test approving ideation gate progresses workflow."""

    # set up fake agent outputs
    class FakeAgent:
        def __init__(self, content):
            self._content = content

        def create_session(self, *_a, **_k):
            return "s"

        def create_turn(self, *_a, **_k):
            class R:
                completion_message = type("cm", (), {"content": self._content})

            return R()

    def fake_create_agent(client, project, role, vector_db_id=None, run_id=None):
        """Return a fake agent that produces role-specific output."""
        outputs = {
            "ideator": "ideas",
            "producer": "producer out",
            "editor": "editor out",
            "publisher": "publisher out",
        }
        return FakeAgent(outputs.get(role, f"{role} out"))

    _patch_create_agent(monkeypatch, fake_create_agent)

    res = run_workflow(
        client=None, brief="b", vector_db_id="kb", run_repo=repo, artifact_repo=artifact_repo
    )
    assert res.status == RunStatus.AWAITING_IDEATION_APPROVAL

    mid = approve_gate(
        client=None,
        run_id=res.run_id,
        gate=GATE_IDEATION,
        run_repo=repo,
        artifact_repo=artifact_repo,
        vector_db_id="kb",
    )

    # After ideation approval, workflow now waits for video generation (webhook-driven)
    assert mid.status == RunStatus.AWAITING_VIDEO_GENERATION

    # Simulate the workflow progressing through webhook stages
    # (In production, KIE.ai webhooks would advance to AWAITING_RENDER, 
    # then Remotion webhook to AWAITING_PUBLISH_APPROVAL)
    # Add video artifact that would be created by Remotion webhook
    from storage.models import ArtifactType
    artifact_repo.create(
        run_id=res.run_id,
        persona="editor",
        artifact_type=ArtifactType.RENDERED_VIDEO,
        uri="https://example.com/video.mp4",
        metadata={"step": "editor"},
    )
    repo.update(res.run_id, status=RunStatus.AWAITING_PUBLISH_APPROVAL.value)
    repo.session.commit()

    final = approve_gate(
        client=None,
        run_id=res.run_id,
        gate=GATE_PUBLISH,
        run_repo=repo,
        artifact_repo=artifact_repo,
        vector_db_id="kb",
    )

    assert final.status == RunStatus.COMPLETED


def test_reject_gate(repo, artifact_repo):
    """Test rejecting a gate fails the run."""
    # create dummy run in awaiting status
    run = repo.create(workflow_name="w", input="b", status=RunStatus.AWAITING_IDEATION_APPROVAL)
    repo.session.commit()

    result = reject_gate(run.id, GATE_IDEATION, repo, artifact_repo, reason="not good")

    assert result.status == RunStatus.FAILED
    stored = repo.get(run.id)
    assert stored.status == RunStatus.FAILED.value
