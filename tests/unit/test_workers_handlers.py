from __future__ import annotations

import json
from dataclasses import dataclass
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from myloware.config import settings
from myloware.services.render_provider import RenderJob, RenderStatus
from myloware.storage.models import ArtifactType, RunStatus
from myloware.workers import handlers
from myloware.workers.exceptions import JobReschedule
from myloware.workers.job_types import (
    JOB_LANGGRAPH_HITL_RESUME,
    JOB_LANGGRAPH_RESUME,
    JOB_LANGGRAPH_RESUME_RENDER,
    JOB_LANGGRAPH_RESUME_VIDEOS,
    JOB_REMOTION_POLL,
    JOB_RUN_EXECUTE,
    JOB_SORA_POLL,
    JOB_WEBHOOK_REMOTION,
    JOB_WEBHOOK_SORA,
)


def test_as_uuid_round_trip() -> None:
    u = uuid4()
    assert handlers._as_uuid(u) == u
    assert handlers._as_uuid(str(u)) == u


def test_safe_json_accepts_dict_and_parses_json_string() -> None:
    assert handlers._safe_json({"a": 1}) == {"a": 1}
    assert handlers._safe_json('{"a": 1}') == {"a": 1}
    assert handlers._safe_json("not json") == {}
    assert handlers._safe_json('["a"]') == {}
    assert handlers._safe_json(123) == {}


@dataclass
class FakeArtifact:
    artifact_type: str
    artifact_metadata: dict[str, object] | None = None
    uri: str | None = None
    content: str | None = None


@dataclass
class FakeRun:
    id: UUID
    status: str
    vector_db_id: str | None = None
    current_step: str | None = None
    artifacts: dict[str, object] | None = None


class FakeRunRepo:
    def __init__(self, run: FakeRun | None) -> None:
        self._run = run
        self.updates: list[tuple[UUID, dict[str, object]]] = []

    async def get_async(self, _run_id: UUID) -> FakeRun | None:
        return self._run

    async def get_for_update_async(self, _run_id: UUID) -> FakeRun | None:
        return self._run

    async def update_async(self, run_id: UUID, **kwargs):  # type: ignore[no-untyped-def]
        self.updates.append((run_id, kwargs))
        if self._run and self._run.id == run_id:
            for k, v in kwargs.items():
                setattr(self._run, k, v)  # simple projection update


class FakeArtifactRepo:
    def __init__(self, artifacts: list[FakeArtifact] | None = None) -> None:
        self.artifacts = list(artifacts or [])
        self.creates: list[dict[str, object]] = []

    async def get_by_run_async(self, _run_id: UUID) -> list[FakeArtifact]:
        return list(self.artifacts)

    async def create_async(self, **kwargs):  # type: ignore[no-untyped-def]
        self.creates.append(kwargs)
        art_type = kwargs.get("artifact_type")
        meta = kwargs.get("metadata")
        uri = kwargs.get("uri")
        content = kwargs.get("content")
        self.artifacts.append(
            FakeArtifact(
                artifact_type=art_type.value if hasattr(art_type, "value") else str(art_type),
                artifact_metadata=meta if isinstance(meta, dict) else None,
                uri=str(uri) if uri is not None else None,
                content=str(content) if content is not None else None,
            )
        )
        return None


class FakeJobRepo:
    def __init__(self) -> None:
        self.enqueued: list[tuple[str, UUID, dict[str, object]]] = []
        self.raise_on_enqueue = False

    async def enqueue_async(self, job_type: str, *, run_id: UUID, payload: dict, **_kwargs):  # type: ignore[no-untyped-def]
        if self.raise_on_enqueue:
            raise ValueError("duplicate")
        self.enqueued.append((job_type, run_id, payload))


@pytest.mark.asyncio
async def test_handle_job_hitl_resume_validations() -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_IDEATION_APPROVAL.value))

    with pytest.raises(ValueError, match="requires run_id"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_HITL_RESUME,
            run_id=None,
            payload={},
            session_run_repo=run_repo,
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    with pytest.raises(ValueError, match="requires gate"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_HITL_RESUME,
            run_id=run_id,
            payload={"gate": "unknown", "approved": True},
            session_run_repo=run_repo,
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    with pytest.raises(ValueError, match="requires boolean approved"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_HITL_RESUME,
            run_id=run_id,
            payload={"gate": "ideation", "approved": "yes"},
            session_run_repo=run_repo,
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_hitl_resume_skips_when_status_mismatch(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.RUNNING.value))

    async def fake_resume(*_a, **_k):  # type: ignore[no-untyped-def]
        raise AssertionError("resume should not be called")

    monkeypatch.setattr("myloware.workflows.langgraph.hitl.resume_hitl_gate", fake_resume)

    await handlers.handle_job(
        job_type=JOB_LANGGRAPH_HITL_RESUME,
        run_id=run_id,
        payload={"gate": "ideation", "approved": True},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )


@pytest.mark.asyncio
async def test_handle_job_hitl_resume_calls_resume(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_IDEATION_APPROVAL.value))
    called: list[tuple[UUID, str, bool, str | None]] = []

    async def fake_resume(run_id_arg, gate: str, *, approved: bool, comment=None):  # type: ignore[no-untyped-def]
        called.append((run_id_arg, gate, approved, comment))

    monkeypatch.setattr("myloware.workflows.langgraph.hitl.resume_hitl_gate", fake_resume)

    await handlers.handle_job(
        job_type=JOB_LANGGRAPH_HITL_RESUME,
        run_id=run_id,
        payload={"gate": "ideation", "approved": True, "comment": "ok"},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    assert called == [(run_id, "ideation", True, "ok")]


@pytest.mark.asyncio
async def test_handle_job_run_execute_validates_and_calls_workflow(monkeypatch) -> None:
    run_id = uuid4()
    run = FakeRun(id=run_id, status=RunStatus.PENDING.value, vector_db_id="kb")
    run_repo = FakeRunRepo(run)
    art_repo = FakeArtifactRepo()
    job_repo = FakeJobRepo()

    called: list[tuple[UUID, str]] = []

    async def fake_run_workflow_async(*, client, run_id: UUID, vector_db_id: str, **_kw):  # type: ignore[no-untyped-def]
        called.append((run_id, vector_db_id))

    monkeypatch.setattr(handlers, "run_workflow_async", fake_run_workflow_async)

    await handlers.handle_job(
        job_type=JOB_RUN_EXECUTE,
        run_id=run_id,
        payload={},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),  # not used by fake
    )

    assert called == [(run_id, "kb")]


@pytest.mark.asyncio
async def test_handle_job_run_execute_idempotent_skip(monkeypatch) -> None:
    run_id = uuid4()
    run = FakeRun(id=run_id, status=RunStatus.RUNNING.value, vector_db_id="kb")
    run_repo = FakeRunRepo(run)

    async def fake_run_workflow_async(**_kw):  # type: ignore[no-untyped-def]
        raise AssertionError("should not be called when run is not PENDING")

    monkeypatch.setattr(handlers, "run_workflow_async", fake_run_workflow_async)

    await handlers.handle_job(
        job_type=JOB_RUN_EXECUTE,
        run_id=run_id,
        payload={},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )


@pytest.mark.asyncio
async def test_handle_job_run_execute_requires_run_id_and_vector_db_id() -> None:
    with pytest.raises(ValueError, match="requires run_id"):
        await handlers.handle_job(
            job_type=JOB_RUN_EXECUTE,
            run_id=None,
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    run_id = uuid4()
    run = FakeRun(id=run_id, status=RunStatus.PENDING.value, vector_db_id=None)
    with pytest.raises(ValueError, match="vector_db_id missing"):
        await handlers.handle_job(
            job_type=JOB_RUN_EXECUTE,
            run_id=run_id,
            payload={},
            session_run_repo=FakeRunRepo(run),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_run_execute_raises_when_run_missing() -> None:
    run_id = uuid4()
    with pytest.raises(ValueError, match="not found"):
        await handlers.handle_job(
            job_type=JOB_RUN_EXECUTE,
            run_id=run_id,
            payload={"vector_db_id": "kb"},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_resume_videos_and_render(monkeypatch) -> None:
    run_id = uuid4()

    called: list[tuple[str, object]] = []

    async def fake_resume_after_videos(_run_id: UUID) -> None:
        called.append(("videos", _run_id))

    async def fake_resume_after_render(_run_id: UUID, video_url: str) -> None:
        called.append(("render", (_run_id, video_url)))

    monkeypatch.setattr(handlers, "resume_after_videos", fake_resume_after_videos)
    monkeypatch.setattr(handlers, "resume_after_render", fake_resume_after_render)

    await handlers.handle_job(
        job_type=JOB_LANGGRAPH_RESUME_VIDEOS,
        run_id=run_id,
        payload={},
        session_run_repo=FakeRunRepo(None),
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )
    await handlers.handle_job(
        job_type=JOB_LANGGRAPH_RESUME_RENDER,
        run_id=run_id,
        payload={"video_url": "https://example.com/v.mp4"},
        session_run_repo=FakeRunRepo(None),
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    assert called == [
        ("videos", run_id),
        ("render", (run_id, "https://example.com/v.mp4")),
    ]

    with pytest.raises(ValueError, match="requires run_id"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_RESUME_VIDEOS,
            run_id=None,
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    with pytest.raises(ValueError, match="requires video_url"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_RESUME_RENDER,
            run_id=run_id,
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    with pytest.raises(ValueError, match="requires run_id"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_RESUME_RENDER,
            run_id=None,
            payload={"video_url": "https://example.com/v.mp4"},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_langgraph_resume_no_interrupts_noops(monkeypatch) -> None:
    run_id = uuid4()

    run = FakeRun(
        id=run_id,
        status=RunStatus.RUNNING.value,
        current_step="ideation",
        artifacts={"foo": "bar"},
    )
    run_repo = FakeRunRepo(run)

    class FakeGraph:
        async def aget_state(self, _config):  # type: ignore[no-untyped-def]
            return SimpleNamespace(interrupts=[])

        async def ainvoke(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            raise AssertionError("should not be invoked when no interrupts")

    monkeypatch.setattr(settings, "use_langgraph_engine", True)
    monkeypatch.setattr(settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(
        "myloware.workflows.langgraph.graph.get_graph",
        lambda: FakeGraph(),
    )

    await handlers.handle_job(
        job_type=JOB_LANGGRAPH_RESUME,
        run_id=run_id,
        payload={"resume_data": {"approved": False}},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    assert run_repo.updates == []


@pytest.mark.asyncio
async def test_handle_job_langgraph_resume_with_interrupt(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(None)

    seen: list[dict[str, object]] = []

    class FakeInterrupt:
        id = "intr-1"
        value = {"waiting_for": "hitl"}

    class FakeGraph:
        async def aget_state(self, _config):  # type: ignore[no-untyped-def]
            return SimpleNamespace(interrupts=[FakeInterrupt()])

        async def ainvoke(self, cmd, *, config, durability):  # type: ignore[no-untyped-def]
            seen.append({"cmd": cmd, "config": config, "durability": durability})
            return None

    monkeypatch.setattr(settings, "use_langgraph_engine", True)
    monkeypatch.setattr(settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(
        "myloware.workflows.langgraph.graph.get_graph",
        lambda: FakeGraph(),
    )

    await handlers.handle_job(
        job_type=JOB_LANGGRAPH_RESUME,
        run_id=run_id,
        payload={"resume_data": '{"approved": true}'},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    assert seen


@pytest.mark.asyncio
async def test_handle_job_langgraph_resume_validates_run_id_and_engine_enabled(monkeypatch) -> None:
    with pytest.raises(ValueError, match="requires run_id"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_RESUME,
            run_id=None,
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    run_id = uuid4()
    monkeypatch.setattr(settings, "use_langgraph_engine", False)
    with pytest.raises(ValueError, match="not enabled"):
        await handlers.handle_job(
            job_type=JOB_LANGGRAPH_RESUME,
            run_id=run_id,
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_langgraph_resume_initializes_checkpointer_for_non_sqlite(
    monkeypatch,
) -> None:
    run_id = uuid4()

    class FakeInterrupt:
        id = "intr-1"
        value = {"waiting_for": "hitl"}

    class FakeGraph:
        async def aget_state(self, _config):  # type: ignore[no-untyped-def]
            return SimpleNamespace(interrupts=[FakeInterrupt()])

        async def ainvoke(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            return None

    called: list[str] = []

    async def fake_ensure_checkpointer_initialized() -> None:
        called.append("checkpointer")

    monkeypatch.setattr(settings, "use_langgraph_engine", True)
    monkeypatch.setattr(settings, "database_url", "postgresql+psycopg2://localhost/test")
    monkeypatch.setattr(
        "myloware.workflows.langgraph.graph.ensure_checkpointer_initialized",
        fake_ensure_checkpointer_initialized,
    )
    monkeypatch.setattr(
        "myloware.workflows.langgraph.graph.get_graph",
        lambda: FakeGraph(),
    )

    await handlers.handle_job(
        job_type=JOB_LANGGRAPH_RESUME,
        run_id=run_id,
        payload={"resume_data": {"approved": True}},
        session_run_repo=FakeRunRepo(None),
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    assert called == ["checkpointer"]


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_happy_path_enqueues_resume(monkeypatch) -> None:
    run_id = uuid4()
    run = FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    run_repo = FakeRunRepo(run)

    # Existing artifacts include a manifest requiring 1 clip.
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.CLIP_MANIFEST.value,
                artifact_metadata={"task_count": 1},
            )
        ]
    )
    job_repo = FakeJobRepo()

    async def fake_transcode_video(_url: str, _run_id: UUID, _video_index: int) -> str:
        return "file:///tmp/out.mp4"

    monkeypatch.setattr(handlers, "transcode_video", fake_transcode_video)
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={
            "code": 200,
            "state": "success",
            "task_id": "task-1",
            "video_index": 0,
            "video_urls": ["https://cdn/video.mp4"],
            "metadata": {"topic": "t", "sign": "s", "object_name": "o"},
        },
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert art_repo.creates
    assert art_repo.creates[-1]["artifact_type"] == ArtifactType.VIDEO_CLIP
    assert art_repo.creates[-1]["uri"] == "file:///tmp/out.mp4"
    assert art_repo.creates[-1]["metadata"]["topic"] == "t"

    assert run_repo.updates
    assert run_repo.updates[-1][1]["status"] == RunStatus.AWAITING_RENDER.value

    assert job_repo.enqueued and job_repo.enqueued[0][0] == JOB_LANGGRAPH_RESUME_VIDEOS


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_failure_and_progress(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value))
    art_repo = FakeArtifactRepo()
    job_repo = FakeJobRepo()

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 500, "state": "fail", "status_msg": "nope"},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )
    assert run_repo.updates[-1][1]["status"] == RunStatus.FAILED.value

    # Progress callback (no URLs): no-op
    run_repo.updates.clear()
    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 200, "state": "success", "task_id": "t", "video_urls": []},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )
    assert run_repo.updates == []


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_validates_run_id_and_parses_video_urls(monkeypatch) -> None:
    with pytest.raises(ValueError, match="requires run_id"):
        await handlers.handle_job(
            job_type=JOB_WEBHOOK_SORA,
            run_id=None,
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value))
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.CLIP_MANIFEST.value,
                artifact_metadata={"task_count": 1},
            )
        ]
    )

    async def fake_transcode_video(_url: str, _run_id: UUID, _video_index: int) -> str:
        return "file:///tmp/out.mp4"

    monkeypatch.setattr(handlers, "transcode_video", fake_transcode_video)
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 200, "state": "success", "video_urls": json.dumps(["u1", "u2"])},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 200, "state": "success", "video_urls": "not-json"},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(
            artifacts=[
                FakeArtifact(
                    artifact_type=ArtifactType.CLIP_MANIFEST.value,
                    artifact_metadata={"task_count": 1},
                )
            ]
        ),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 200, "state": "success", "video_urls": 123},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": "oops", "state": "success", "video_urls": ["u1"]},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_missing_original_url_marks_failed(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value))
    art_repo = FakeArtifactRepo()
    job_repo = FakeJobRepo()

    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "webhook_base_url", "")

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"event_type": "video.completed", "task_id": "t1", "video_urls": []},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert run_repo.updates
    assert run_repo.updates[-1][1]["status"] == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_real_download_cleanup_error(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value))
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.CLIP_MANIFEST.value,
                artifact_metadata={"type": "task_metadata_mapping", "task_count": 1},
            )
        ]
    )
    job_repo = FakeJobRepo()

    class FakePath:
        def as_uri(self):
            return "file:///tmp/fake.mp4"

        def unlink(self, missing_ok=True):
            raise RuntimeError("cleanup failed")

    async def fake_download(_task_id: str):
        return FakePath()

    async def fake_transcode(_url: str, _run_id: UUID, _video_index: int):
        return "file:///tmp/out.mp4"

    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(handlers, "download_openai_video_content_to_tempfile", fake_download)
    monkeypatch.setattr(handlers, "transcode_video", fake_transcode)

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"event_type": "video.completed", "task_id": "t1", "video_urls": []},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert art_repo.creates


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_skips_resume_when_run_failed(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.FAILED.value))
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.CLIP_MANIFEST.value,
                artifact_metadata={"type": "task_metadata_mapping", "task_count": 1},
            )
        ]
    )
    job_repo = FakeJobRepo()

    async def fake_transcode(_url: str, _run_id: UUID, _video_index: int):
        return "file:///tmp/out.mp4"

    monkeypatch.setattr(handlers, "transcode_video", fake_transcode)

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={
            "code": 200,
            "state": "success",
            "task_id": "task-1",
            "video_index": 0,
            "video_urls": ["https://cdn/video.mp4"],
        },
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert job_repo.enqueued == []


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_transcode_and_projection_error_paths(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value))

    async def fake_transcode_none(*_a, **_kw):  # type: ignore[no-untyped-def]
        return ""

    monkeypatch.setattr(handlers, "transcode_video", fake_transcode_none)
    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 200, "state": "success", "video_urls": ["u1"]},
        session_run_repo=run_repo,
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )
    assert run_repo._run is not None
    assert run_repo._run.status == RunStatus.FAILED.value
    assert any(
        upd_run_id == run_id
        and updates.get("status") == RunStatus.FAILED.value
        and "Transcode failed" in str(updates.get("error") or "")
        for upd_run_id, updates in run_repo.updates
    )

    async def fake_transcode_ok(*_a, **_kw):  # type: ignore[no-untyped-def]
        return "file:///tmp/out.mp4"

    monkeypatch.setattr(handlers, "transcode_video", fake_transcode_ok)
    with pytest.raises(ValueError, match="Run not found"):
        await handlers.handle_job(
            job_type=JOB_WEBHOOK_SORA,
            run_id=run_id,
            payload={"code": 200, "state": "success", "video_urls": ["u1"]},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(
                artifacts=[
                    FakeArtifact(
                        artifact_type=ArtifactType.CLIP_MANIFEST.value,
                        artifact_metadata={"task_count": 1},
                    )
                ]
            ),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_enq_duplicate_is_swallowed(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value))
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.CLIP_MANIFEST.value,
                artifact_metadata={"task_count": 1},
            )
        ]
    )
    job_repo = FakeJobRepo()
    job_repo.raise_on_enqueue = True

    async def fake_transcode_ok(*_a, **_kw):  # type: ignore[no-untyped-def]
        return "file:///tmp/out.mp4"

    monkeypatch.setattr(handlers, "transcode_video", fake_transcode_ok)
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 200, "state": "success", "video_urls": ["u1"]},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert job_repo.enqueued == []


@pytest.mark.asyncio
async def test_handle_job_webhook_sora_idempotent_skip(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_VIDEO_GENERATION.value))

    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.VIDEO_CLIP.value,
                artifact_metadata={"task_id": "task-1"},
            )
        ]
    )

    async def fake_transcode_video(*_a, **_kw):  # type: ignore[no-untyped-def]
        raise AssertionError("should not transcode on idempotent replay")

    monkeypatch.setattr(handlers, "transcode_video", fake_transcode_video)

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_SORA,
        run_id=run_id,
        payload={"code": 200, "state": "success", "task_id": "task-1", "video_urls": ["u"]},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )


@pytest.mark.asyncio
async def test_handle_job_webhook_remotion_happy_path_and_idempotency(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_RENDER.value))
    art_repo = FakeArtifactRepo()
    job_repo = FakeJobRepo()
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_REMOTION,
        run_id=run_id,
        payload={"status": "done", "job_id": "job-1", "output_url": "https://cdn/out.mp4"},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )
    assert art_repo.creates and art_repo.creates[-1]["artifact_type"] == ArtifactType.RENDERED_VIDEO
    assert job_repo.enqueued and job_repo.enqueued[-1][0] == JOB_LANGGRAPH_RESUME_RENDER

    # Idempotency skip
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.RENDERED_VIDEO.value,
                artifact_metadata={"render_job_id": "job-1"},
            )
        ]
    )
    await handlers.handle_job(
        job_type=JOB_WEBHOOK_REMOTION,
        run_id=run_id,
        payload={"status": "completed", "job_id": "job-1", "output_url": "https://cdn/out.mp4"},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=FakeJobRepo(),
        llama_client=object(),
    )
    assert art_repo.creates == []


@pytest.mark.asyncio
async def test_handle_job_webhook_remotion_converts_internal_url(monkeypatch) -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_RENDER.value))
    art_repo = FakeArtifactRepo()
    job_repo = FakeJobRepo()

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "webhook_base_url", "https://example.com")

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_REMOTION,
        run_id=run_id,
        payload={
            "status": "done",
            "job_id": "job-1",
            "output_url": "http://remotion:3001/output/abc123.mp4",
        },
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert art_repo.creates
    assert art_repo.creates[-1]["uri"] == "https://example.com/v1/media/video/abc123"
    assert job_repo.enqueued
    assert job_repo.enqueued[-1][2]["video_url"] == "https://example.com/v1/media/video/abc123"


@pytest.mark.asyncio
async def test_handle_job_webhook_remotion_failure_and_progress_and_validation() -> None:
    run_id = uuid4()
    run_repo = FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_RENDER.value))
    art_repo = FakeArtifactRepo()
    job_repo = FakeJobRepo()

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_REMOTION,
        run_id=run_id,
        payload={"status": "error", "error": "boom"},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )
    assert run_repo.updates[-1][1]["status"] == RunStatus.FAILED.value

    # Progress ignored
    run_repo.updates.clear()
    await handlers.handle_job(
        job_type=JOB_WEBHOOK_REMOTION,
        run_id=run_id,
        payload={"status": "queued", "job_id": "job-1"},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )
    assert run_repo.updates == []

    with pytest.raises(ValueError, match="No output_url"):
        await handlers.handle_job(
            job_type=JOB_WEBHOOK_REMOTION,
            run_id=run_id,
            payload={"status": "done", "job_id": "job-1"},
            session_run_repo=run_repo,
            session_artifact_repo=art_repo,
            session_job_repo=job_repo,
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_webhook_remotion_validates_run_id_and_swallow_duplicate_enq(
    monkeypatch,
) -> None:
    with pytest.raises(ValueError, match="requires run_id"):
        await handlers.handle_job(
            job_type=JOB_WEBHOOK_REMOTION,
            run_id=None,
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )

    run_id = uuid4()
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    job_repo = FakeJobRepo()
    job_repo.raise_on_enqueue = True

    await handlers.handle_job(
        job_type=JOB_WEBHOOK_REMOTION,
        run_id=run_id,
        payload={"status": "done", "job_id": "job-1", "outputUrl": "https://cdn/out.mp4"},
        session_run_repo=FakeRunRepo(FakeRun(id=run_id, status=RunStatus.AWAITING_RENDER.value)),
        session_artifact_repo=FakeArtifactRepo(),
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert job_repo.enqueued == []


@pytest.mark.asyncio
async def test_handle_job_unknown_job_type_raises() -> None:
    with pytest.raises(ValueError, match="Unknown job_type"):
        await handlers.handle_job(
            job_type="nope",
            run_id=uuid4(),
            payload={},
            session_run_repo=FakeRunRepo(None),
            session_artifact_repo=FakeArtifactRepo(),
            session_job_repo=FakeJobRepo(),
            llama_client=object(),
        )


@pytest.mark.asyncio
async def test_handle_job_sora_poll_reschedules_until_complete(monkeypatch) -> None:
    run_id = uuid4()

    class FakeSession:
        def __init__(self) -> None:
            self.commits = 0

        async def commit(self) -> None:
            self.commits += 1

    class FakeRunRepoPoll(FakeRunRepo):
        def __init__(self, run: FakeRun) -> None:
            super().__init__(run)
            self.session = FakeSession()
            self.artifacts_added: list[tuple[UUID, str, object]] = []

        async def add_artifact_async(self, run_id: UUID, key: str, value: object):  # type: ignore[no-untyped-def]
            self.artifacts_added.append((run_id, key, value))
            if self._run and self._run.id == run_id:
                artifacts = dict(self._run.artifacts or {})
                artifacts[key] = value
                self._run.artifacts = artifacts

    run = FakeRun(
        id=run_id,
        status=RunStatus.AWAITING_VIDEO_GENERATION.value,
        artifacts={"pending_task_ids": ["video_1"]},
    )
    run_repo = FakeRunRepoPoll(run)
    art_repo = FakeArtifactRepo()
    job_repo = FakeJobRepo()

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "sora_provider", "real")

    async def fake_retrieve(video_id: str) -> dict[str, object]:
        assert video_id == "video_1"
        return {"id": video_id, "status": "in_progress", "progress": 30}

    monkeypatch.setattr(handlers, "retrieve_openai_video_job", fake_retrieve)

    with pytest.raises(JobReschedule):
        await handlers.handle_job(
            job_type=JOB_SORA_POLL,
            run_id=run_id,
            payload={},
            session_run_repo=run_repo,
            session_artifact_repo=art_repo,
            session_job_repo=job_repo,
            llama_client=object(),
        )

    assert run_repo.artifacts_added
    assert run_repo.artifacts_added[-1][1] == "sora_progress"
    assert run_repo.session.commits == 1


@pytest.mark.asyncio
async def test_handle_job_sora_poll_ingests_completed_clip(monkeypatch, tmp_path) -> None:
    run_id = uuid4()

    class FakeSession:
        def __init__(self) -> None:
            self.commits = 0

        async def commit(self) -> None:
            self.commits += 1

    class FakeRunRepoPoll(FakeRunRepo):
        def __init__(self, run: FakeRun) -> None:
            super().__init__(run)
            self.session = FakeSession()
            self.artifacts_added: list[tuple[UUID, str, object]] = []

        async def add_artifact_async(self, run_id: UUID, key: str, value: object):  # type: ignore[no-untyped-def]
            self.artifacts_added.append((run_id, key, value))
            if self._run and self._run.id == run_id:
                artifacts = dict(self._run.artifacts or {})
                artifacts[key] = value
                self._run.artifacts = artifacts

    run = FakeRun(
        id=run_id,
        status=RunStatus.AWAITING_VIDEO_GENERATION.value,
        artifacts={"pending_task_ids": ["video_1"]},
    )
    run_repo = FakeRunRepoPoll(run)

    # Provide a manifest so the handler can infer video_index + expected_count.
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.CLIP_MANIFEST.value,
                content=json.dumps({"video_1": {"video_index": 0}}),
                artifact_metadata={"type": "task_metadata_mapping", "task_count": 1},
            )
        ]
    )
    job_repo = FakeJobRepo()

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "sora_provider", "real")

    async def fake_retrieve(video_id: str) -> dict[str, object]:
        assert video_id == "video_1"
        return {"id": video_id, "status": "completed", "progress": 100}

    async def fake_download(_video_id: str):  # type: ignore[no-untyped-def]
        path = tmp_path / "video.mp4"
        path.write_bytes(b"fake")
        return path

    async def fake_transcode(_url: str, _run_id: UUID, _video_index: int):  # type: ignore[no-untyped-def]
        return "https://cdn.example/transcoded.mp4"

    monkeypatch.setattr(handlers, "retrieve_openai_video_job", fake_retrieve)
    monkeypatch.setattr(handlers, "download_openai_video_content_to_tempfile", fake_download)
    monkeypatch.setattr(handlers, "transcode_video", fake_transcode)

    await handlers.handle_job(
        job_type=JOB_SORA_POLL,
        run_id=run_id,
        payload={},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert any(
        c.get("artifact_type") == ArtifactType.VIDEO_CLIP
        and c.get("uri") == "https://cdn.example/transcoded.mp4"
        for c in art_repo.creates
    )
    assert run.status == RunStatus.AWAITING_RENDER.value
    assert run_repo.session.commits == 1


@pytest.mark.asyncio
async def test_handle_job_remotion_poll_reschedules_until_complete(monkeypatch) -> None:
    run_id = uuid4()

    class FakeSession:
        def __init__(self) -> None:
            self.commits = 0

        async def commit(self) -> None:
            self.commits += 1

    class FakeRunRepoPoll(FakeRunRepo):
        def __init__(self, run: FakeRun) -> None:
            super().__init__(run)
            self.session = FakeSession()
            self.artifacts_added: list[tuple[UUID, str, object]] = []

        async def add_artifact_async(self, run_id: UUID, key: str, value: object):  # type: ignore[no-untyped-def]
            self.artifacts_added.append((run_id, key, value))
            if self._run and self._run.id == run_id:
                artifacts = dict(self._run.artifacts or {})
                artifacts[key] = value
                self._run.artifacts = artifacts

    run = FakeRun(id=run_id, status=RunStatus.AWAITING_RENDER.value)
    run_repo = FakeRunRepoPoll(run)
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.EDITOR_OUTPUT.value,
                artifact_metadata={"render_job_id": "job-1"},
            )
        ]
    )
    job_repo = FakeJobRepo()

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")

    async def fake_get_status(self, job_id: str) -> RenderJob:  # type: ignore[no-untyped-def]
        assert job_id == "job-1"
        return RenderJob(
            job_id=job_id,
            status=RenderStatus.RENDERING,
            metadata={"progress": 0.4},
        )

    monkeypatch.setattr(handlers.LocalRemotionProvider, "get_status", fake_get_status)

    with pytest.raises(JobReschedule):
        await handlers.handle_job(
            job_type=JOB_REMOTION_POLL,
            run_id=run_id,
            payload={},
            session_run_repo=run_repo,
            session_artifact_repo=art_repo,
            session_job_repo=job_repo,
            llama_client=object(),
        )

    assert run_repo.artifacts_added
    assert run_repo.artifacts_added[-1][1] == "remotion_progress"
    assert isinstance(run_repo.artifacts_added[-1][2], dict)
    assert run_repo.artifacts_added[-1][2].get("progress_percent") == 40
    assert run_repo.session.commits == 1


@pytest.mark.asyncio
async def test_handle_job_remotion_poll_completes_and_enqueues_resume(monkeypatch) -> None:
    run_id = uuid4()

    class FakeSession:
        def __init__(self) -> None:
            self.commits = 0

        async def commit(self) -> None:
            self.commits += 1

    class FakeRunRepoPoll(FakeRunRepo):
        def __init__(self, run: FakeRun) -> None:
            super().__init__(run)
            self.session = FakeSession()
            self.artifacts_added: list[tuple[UUID, str, object]] = []

        async def add_artifact_async(self, run_id: UUID, key: str, value: object):  # type: ignore[no-untyped-def]
            self.artifacts_added.append((run_id, key, value))
            if self._run and self._run.id == run_id:
                artifacts = dict(self._run.artifacts or {})
                artifacts[key] = value
                self._run.artifacts = artifacts

    run = FakeRun(id=run_id, status=RunStatus.AWAITING_RENDER.value)
    run_repo = FakeRunRepoPoll(run)
    art_repo = FakeArtifactRepo(
        artifacts=[
            FakeArtifact(
                artifact_type=ArtifactType.EDITOR_OUTPUT.value,
                artifact_metadata={"render_job_id": "job-1"},
            )
        ]
    )
    job_repo = FakeJobRepo()

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")

    async def fake_get_status(self, job_id: str) -> RenderJob:  # type: ignore[no-untyped-def]
        assert job_id == "job-1"
        return RenderJob(
            job_id=job_id,
            status=RenderStatus.COMPLETED,
            artifact_url="https://cdn.example/out.mp4",
            metadata={"progress": 1.0},
        )

    monkeypatch.setattr(handlers.LocalRemotionProvider, "get_status", fake_get_status)

    await handlers.handle_job(
        job_type=JOB_REMOTION_POLL,
        run_id=run_id,
        payload={},
        session_run_repo=run_repo,
        session_artifact_repo=art_repo,
        session_job_repo=job_repo,
        llama_client=object(),
    )

    assert any(
        c.get("artifact_type") == ArtifactType.RENDERED_VIDEO
        and c.get("uri") == "https://cdn.example/out.mp4"
        for c in art_repo.creates
    )
    assert job_repo.enqueued and job_repo.enqueued[-1][0] == JOB_LANGGRAPH_RESUME_RENDER
    assert run_repo.session.commits == 1
