"""Unit tests for run repository."""

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from storage.models import ArtifactType, Base, RunStatus
from storage.repositories import ArtifactRepository, RunRepository


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def run_repo(db_session):
    return RunRepository(db_session)


@pytest.fixture
def artifact_repo(db_session):
    return ArtifactRepository(db_session)


def test_create_run(run_repo):
    run = run_repo.create(workflow_name="aismr", input="Test brief")

    assert run.id is not None
    assert run.workflow_name == "aismr"
    assert run.input == "Test brief"
    assert run.status == RunStatus.PENDING.value


def test_get_run(run_repo):
    created = run_repo.create("aismr", "Test")

    found = run_repo.get(created.id)

    assert found is not None
    assert found.id == created.id


def test_get_run_not_found(run_repo):
    found = run_repo.get(uuid.uuid4())
    assert found is None


def test_update_status(run_repo):
    run = run_repo.create("aismr", "Test")

    updated = run_repo.update_status(run.id, RunStatus.RUNNING)

    assert updated.status == RunStatus.RUNNING.value


def test_add_artifact(run_repo):
    run = run_repo.create("aismr", "Test")

    run_repo.add_artifact(run.id, "ideas", "Some ideas here")

    updated = run_repo.get(run.id)
    assert updated.artifacts["ideas"] == "Some ideas here"


def test_list_runs(run_repo):
    run_repo.create("aismr", "Test 1")
    run_repo.create("aismr", "Test 2")
    run_repo.create("aismr", "Test 3")

    runs = run_repo.list(limit=2)

    assert len(runs) == 2


def test_list_runs_by_status(run_repo):
    run_repo.create("aismr", "Test 1")
    run2 = run_repo.create("aismr", "Test 2")
    run_repo.update_status(run2.id, RunStatus.COMPLETED)

    pending = run_repo.list(status=RunStatus.PENDING)
    completed = run_repo.list(status=RunStatus.COMPLETED)

    assert len(pending) == 1
    assert len(completed) == 1


def test_update_step(run_repo):
    run = run_repo.create("aismr", "Test")
    run_repo.update_step(run.id, "ideation")

    updated = run_repo.get(run.id)
    assert updated.current_step == "ideation"


def test_create_artifact(run_repo, artifact_repo):
    run = run_repo.create("aismr", "Test brief")
    artifact = artifact_repo.create(
        run_id=run.id,
        persona="ideator",
        artifact_type=ArtifactType.IDEAS,
        content="idea text",
        metadata={"step": "ideator"},
        trace_id="trace-123",
    )

    assert artifact.id is not None
    assert artifact.artifact_metadata.get("trace_id") == "trace-123"
    assert artifact.artifact_type == ArtifactType.IDEAS.value


def test_get_artifacts_by_run(run_repo, artifact_repo):
    run = run_repo.create("aismr", "Test brief")
    artifact_repo.create(run.id, "ideator", ArtifactType.IDEAS, content="ideas")
    artifact_repo.create(run.id, "producer", ArtifactType.CLIP_MANIFEST, content="clips")

    artifacts = artifact_repo.get_by_run(run.id)

    assert len(artifacts) == 2
    assert artifacts[0].persona == "ideator"
    assert artifacts[1].artifact_type == ArtifactType.CLIP_MANIFEST.value


def test_get_artifact_by_type(run_repo, artifact_repo):
    run = run_repo.create("aismr", "Test brief")
    artifact_repo.create(run.id, "ideator", ArtifactType.IDEAS, content="ideas")

    found = artifact_repo.get_by_type(run.id, ArtifactType.IDEAS)

    assert found is not None
    assert found.content == "ideas"
