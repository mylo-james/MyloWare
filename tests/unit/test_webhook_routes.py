"""Unit tests for webhook endpoints."""

from __future__ import annotations

import hashlib
import hmac
import json
from uuid import UUID, uuid4

import pytest

from myloware.storage.models import ArtifactType, RunStatus


async def _create_run(*, status: str = RunStatus.PENDING.value) -> UUID:
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import RunRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.create_async(workflow_name="aismr", input="x", status=RunStatus(status))
        await session.commit()
        return run.id


async def _create_clip_manifest_mapping(run_id: UUID, mapping: dict[str, dict]) -> None:
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import ArtifactRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = ArtifactRepository(session)
        await repo.create_async(
            run_id=run_id,
            persona="producer",
            artifact_type=ArtifactType.CLIP_MANIFEST,
            content=json.dumps(mapping),
            metadata={"type": "task_metadata_mapping", "task_count": len(mapping)},
        )
        await session.commit()


async def _create_editor_output_with_job_id(run_id: UUID, job_id: str) -> None:
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import ArtifactRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = ArtifactRepository(session)
        await repo.create_async(
            run_id=run_id,
            persona="editor",
            artifact_type=ArtifactType.EDITOR_OUTPUT,
            content="editor",
            metadata={"render_job_id": job_id},
        )
        await session.commit()


async def _create_rendered_video(run_id: UUID, job_id: str, url: str) -> None:
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import ArtifactRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = ArtifactRepository(session)
        await repo.create_async(
            run_id=run_id,
            persona="editor",
            artifact_type=ArtifactType.RENDERED_VIDEO,
            uri=url,
            metadata={"render_job_id": job_id},
        )
        await session.commit()


@pytest.mark.anyio
async def test_sora_webhook_requires_run_id_query_param(async_client) -> None:
    resp = await async_client.post("/v1/webhooks/sora", json={"urls": ["https://x"]})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Missing run_id query parameter"


@pytest.mark.anyio
async def test_sora_webhook_test_mode_accepts_urls(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    run_id = uuid4()
    resp = await async_client.post(
        f"/v1/webhooks/sora?run_id={run_id}",
        json={"urls": ["https://example.com/v.mp4"]},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "accepted"
    assert payload["video_url"] == "https://example.com/v.mp4"


@pytest.mark.anyio
async def test_sora_webhook_scale_mode_is_idempotent(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")

    payload = {
        "code": 200,
        "msg": "success",
        "data": {
            "state": "success",
            "info": {"resultUrls": ["https://example.com/v.mp4"]},
            "metadata": {"videoIndex": 0},
        },
    }

    # First call enqueues a job.
    resp1 = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp1.status_code == 200

    # Second call should still ACK (job already enqueued).
    resp2 = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "accepted"


@pytest.mark.anyio
async def test_sora_webhook_unknown_task_id_ignored_in_real_processing_mode(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    payload = {
        "code": 200,
        "msg": "success",
        "data": {
            "taskId": "task-unknown",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/v.mp4"]},
        },
    }

    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ignored"
    assert body["run_id"] == str(run_id)
    assert body["task_id"] == "task-unknown"
    assert "Unknown task_id" in (body.get("error") or "")


@pytest.mark.anyio
async def test_sora_webhook_full_processing_creates_clip_and_updates_status(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(
        run_id,
        {"task-1": {"topic": "cats", "sign": "aries", "videoIndex": 0, "object_name": "obj"}},
    )

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    async def transcode_video(_url: str, _run_id: UUID, _video_index: int):
        return "https://cdn.example/transcoded.mp4"

    monkeypatch.setattr("myloware.api.routes.webhooks.transcode_video", transcode_video)

    async def resume_after_videos(_run_id: UUID):
        return None

    monkeypatch.setattr(
        "myloware.workflows.langgraph.resume.resume_after_videos", resume_after_videos
    )

    payload = {
        "code": 200,
        "msg": "success",
        "data": {
            "taskId": "task-1",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/original.mp4"]},
            "metadata": {"videoIndex": 0},
        },
    }

    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"

    # Assert DB side effects (clip saved, status projected).
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import ArtifactRepository, RunRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        ar = ArtifactRepository(session)
        rr = RunRepository(session)
        clips = [
            a
            for a in await ar.get_by_run_async(run_id)
            if a.artifact_type == ArtifactType.VIDEO_CLIP.value
        ]
        assert len(clips) == 1
        assert clips[0].uri == "https://cdn.example/transcoded.mp4"
        run = await rr.get_async(run_id)
        assert run is not None
        assert run.status == RunStatus.AWAITING_RENDER.value


@pytest.mark.anyio
async def test_remotion_webhook_missing_run_id(async_client) -> None:
    resp = await async_client.post("/v1/webhooks/remotion", json={"status": "done"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Missing run_id query parameter"


@pytest.mark.anyio
async def test_remotion_webhook_idempotent_when_render_already_saved(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)
    await _create_rendered_video(run_id, "job-1", "https://cdn.example/final.mp4")

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "fake")  # skip status/job validation

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={"status": "done", "output_url": "https://ignored", "job_id": "job-1"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "accepted"
    assert payload["output_url"] == "https://cdn.example/final.mp4"


@pytest.mark.anyio
async def test_remotion_webhook_converts_localhost_url_and_acks(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "fake")  # skip status/job validation

    async def resume_after_render(_run_id: UUID, _url: str):
        return None

    monkeypatch.setattr(
        "myloware.workflows.langgraph.resume.resume_after_render", resume_after_render
    )

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={
            "status": "done",
            "output_url": "http://localhost:3001/video/abc.mp4",
            "job_id": "job-1",
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "accepted"
    assert "/v1/media/video/abc" in payload["output_url"]


@pytest.mark.anyio
async def test_remotion_webhook_real_mode_verifies_signature_and_job_id(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)
    await _create_editor_output_with_job_id(run_id, "job-1")

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    async def resume_after_render(_run_id: UUID, _url: str):
        return None

    monkeypatch.setattr(
        "myloware.workflows.langgraph.resume.resume_after_render", resume_after_render
    )

    payload = json.dumps(
        {"status": "done", "output_url": "https://cdn.example/final.mp4", "job_id": "job-1"}
    ).encode()
    digest = hmac.new(b"secret", payload, hashlib.sha512).hexdigest()

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        content=payload,
        headers={"X-Remotion-Signature": f"sha512={digest}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.anyio
async def test_sora_webhook_missing_video_url_errors(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import RunRepository

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-5": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "webhook_base_url", "")

    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-5"}}

    resp = await async_client.post("/v1/webhooks/sora", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.get_async(run_id)
        assert run is not None
        assert run.status == RunStatus.FAILED.value


@pytest.mark.anyio
async def test_sora_webhook_download_failure_marks_failed(async_client, monkeypatch) -> None:
    from types import SimpleNamespace
    import sys

    from myloware.config.settings import settings
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import RunRepository

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-6": {"videoIndex": 0}})

    class FakeOpenAI:
        def __init__(self, *_a, **_k):
            self.webhooks = SimpleNamespace(verify_signature=lambda **_kw: None)

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setattr(settings, "openai_standard_webhook_secret", "secret")
    monkeypatch.setattr(settings, "openai_api_key", "key")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    async def fake_download(_task_id: str):
        raise RuntimeError("download failed")

    monkeypatch.setattr(
        "myloware.api.routes.webhooks.download_openai_video_content_to_tempfile",
        fake_download,
    )

    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-6"}}
    resp = await async_client.post("/v1/webhooks/sora", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.get_async(run_id)
        assert run is not None
        assert run.status == RunStatus.FAILED.value


@pytest.mark.anyio
async def test_sora_webhook_download_cleanup_on_transcode_failure(
    async_client, monkeypatch
) -> None:
    from types import SimpleNamespace
    from pathlib import Path
    import sys
    import tempfile

    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-7": {"videoIndex": 0}})

    class FakeOpenAI:
        def __init__(self, *_a, **_k):
            self.webhooks = SimpleNamespace(verify_signature=lambda **_kw: None)

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setattr(settings, "openai_standard_webhook_secret", "secret")
    monkeypatch.setattr(settings, "openai_api_key", "key")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    tmp_file = tempfile.NamedTemporaryFile(delete=False)
    tmp_path = Path(tmp_file.name)
    tmp_file.close()

    async def fake_download(_task_id: str):
        return tmp_path

    async def fake_transcode(_url: str, _run_id: UUID, _video_index: int):
        return None

    monkeypatch.setattr(
        "myloware.api.routes.webhooks.download_openai_video_content_to_tempfile",
        fake_download,
    )
    monkeypatch.setattr("myloware.api.routes.webhooks.transcode_video", fake_transcode)

    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-7"}}
    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"
    assert not tmp_path.exists()


@pytest.mark.anyio
async def test_sora_webhook_event_missing_task_id(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    payload = {"object": "event", "type": "video.completed", "data": {}}

    resp = await async_client.post(
        "/v1/webhooks/sora?run_id=00000000-0000-0000-0000-000000000001",
        json=payload,
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Missing data.id"


@pytest.mark.anyio
async def test_sora_webhook_progress_returns_pending(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-2": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    payload = {
        "code": 200,
        "msg": "processing",
        "data": {"taskId": "task-2", "state": "processing", "info": {}},
    }

    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


@pytest.mark.anyio
async def test_sora_webhook_failure_marks_run_failed(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-3": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    payload = {
        "code": 500,
        "msg": "failed",
        "data": {"taskId": "task-3", "state": "fail", "info": {}},
    }

    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"

    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import RunRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.get_async(run_id)
        assert run is not None
        assert run.status == RunStatus.FAILED.value


@pytest.mark.anyio
async def test_sora_webhook_transcode_failure(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-4": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    async def transcode_video(_url: str, _run_id: UUID, _video_index: int):
        return None

    monkeypatch.setattr("myloware.api.routes.webhooks.transcode_video", transcode_video)

    payload = {
        "code": 200,
        "msg": "success",
        "data": {
            "taskId": "task-4",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/original.mp4"]},
        },
    }

    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"


@pytest.mark.anyio
async def test_sora_webhook_event_unknown_type_ignored(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {"object": "event", "type": "video.progress", "data": {"id": "task-x"}}

    resp = await async_client.post("/v1/webhooks/sora", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ignored"


@pytest.mark.anyio
async def test_sora_webhook_event_unknown_task_id_errors_in_test_mode(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {
        "object": "event",
        "type": "video.completed",
        "code": 200,
        "data": {"id": "task-unknown"},
    }

    resp = await async_client.post("/v1/webhooks/sora", json=payload)
    assert resp.status_code == 400
    assert "Unknown task_id" in resp.json()["detail"]


@pytest.mark.anyio
async def test_sora_webhook_event_resolves_run_id_from_manifest_scale_mode(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-ev": {"videoIndex": 1}})

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-ev"}}

    resp = await async_client.post("/v1/webhooks/sora", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "accepted"
    assert body["run_id"] == str(run_id)
    assert body["video_index"] == 1


@pytest.mark.anyio
async def test_sora_webhook_standard_event_nested_object_creates_clip(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import ArtifactRepository

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(
        run_id,
        {
            "task-nested": {
                "videoIndex": 0,
                "topic": "mountains",
                "sign": "aries",
                "object_name": "river",
            }
        },
    )

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "webhook_base_url", "http://localhost:8000")

    async def transcode_video(_url: str, _run_id: UUID, _video_index: int):
        return "https://cdn.example/transcoded.mp4"

    monkeypatch.setattr("myloware.api.routes.webhooks.transcode_video", transcode_video)

    payload = {
        "object": "event",
        "type": "video.completed",
        "data": {"id": "evt_123", "object": {"id": "task-nested"}},
    }

    resp = await async_client.post("/v1/webhooks/sora", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = ArtifactRepository(session)
        clips = [
            a
            for a in await repo.get_by_run_async(run_id)
            if a.artifact_type == ArtifactType.VIDEO_CLIP.value
        ]
        assert clips
        meta = clips[-1].artifact_metadata or {}
        assert meta.get("topic") == "mountains"
        assert meta.get("sign") == "aries"
        assert meta.get("object_name") == "river"


@pytest.mark.anyio
async def test_sora_webhook_requires_secret_in_real_mode(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "openai_standard_webhook_secret", "")
    monkeypatch.setattr(settings, "openai_sora_signing_secret", "")

    resp = await async_client.post(
        "/v1/webhooks/sora", json={"object": "event", "type": "video.completed"}
    )
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_sora_webhook_fast_path_error_in_test_mode(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-err": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {"code": 500, "data": {"taskId": "task-err", "state": "fail"}}
    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"


@pytest.mark.anyio
async def test_sora_webhook_db_dispatcher_handles_duplicate_enqueue(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-db": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    async def raise_enqueue(self, *_a, **_k):  # type: ignore[no-untyped-def]
        raise ValueError("duplicate")

    monkeypatch.setattr("myloware.storage.repositories.JobRepository.enqueue_async", raise_enqueue)

    payload = {"code": 200, "data": {"taskId": "task-db", "state": "success"}}
    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.anyio
async def test_sora_webhook_legacy_result_json_parses_urls(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-legacy": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {
        "code": 200,
        "data": {
            "taskId": "task-legacy",
            "state": "success",
            "info": {},
            "resultJson": json.dumps({"resultUrls": ["https://example.com/a.mp4"]}),
        },
    }
    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.anyio
async def test_remotion_webhook_missing_signature_real_mode(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={"status": "done", "output_url": "https://cdn.example/final.mp4", "job_id": "job-1"},
    )
    assert resp.status_code == 401
    assert "signature" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_remotion_webhook_invalid_signature(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    payload = json.dumps(
        {"status": "done", "output_url": "https://cdn.example/final.mp4", "job_id": "job-1"}
    ).encode()

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        content=payload,
        headers={"X-Remotion-Signature": "sha512=bad"},
    )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_remotion_webhook_run_not_found(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={uuid4()}",
        json={"status": "done", "output_url": "https://cdn.example/final.mp4"},
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_remotion_webhook_wrong_status_rejected(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.RUNNING.value)

    payload = json.dumps(
        {"status": "done", "output_url": "https://cdn.example/final.mp4", "job_id": "job-1"}
    ).encode()
    digest = hmac.new(b"secret", payload, hashlib.sha512).hexdigest()

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        content=payload,
        headers={"X-Remotion-Signature": f"sha512={digest}"},
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_remotion_webhook_invalid_json(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        content="not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_remotion_webhook_fast_path_error(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={"status": "error", "error": "boom"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"


@pytest.mark.anyio
async def test_remotion_webhook_fast_path_missing_output_url(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={"status": "done"},
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_remotion_webhook_error_marks_failed(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import RunRepository

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={"status": "error", "error": "boom", "job_id": "job-err"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.get_async(run_id)
        assert run is not None
        assert run.status == RunStatus.FAILED.value


@pytest.mark.anyio
async def test_remotion_webhook_pending_returns_pending(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={"status": "processing", "job_id": "job-pending"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "processing"


@pytest.mark.anyio
async def test_remotion_webhook_missing_output_url_errors(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        json={"status": "done", "job_id": "job-missing"},
    )
    assert resp.status_code == 400
    assert "output_url" in resp.json()["detail"]


@pytest.mark.anyio
async def test_remotion_webhook_unknown_job_id_rejected(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    payload = json.dumps(
        {"status": "done", "output_url": "https://cdn.example/final.mp4", "job_id": "job-404"}
    ).encode()
    digest = hmac.new(b"secret", payload, hashlib.sha512).hexdigest()

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        content=payload,
        headers={"X-Remotion-Signature": f"sha512={digest}"},
    )
    assert resp.status_code == 400
    assert "unknown job_id" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_sora_webhook_event_object_string_uses_video_id(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-video": {"videoIndex": 2}})

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {
        "object": "event",
        "type": "video.completed",
        "code": 200,
        "data": {"id": "evt_1", "object": "video", "video_id": "task-video"},
    }

    resp = await async_client.post("/v1/webhooks/sora", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == str(run_id)
    assert body["video_index"] == 2


@pytest.mark.anyio
async def test_sora_webhook_legacy_invalid_result_json_returns_error(
    async_client, monkeypatch
) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {
        "code": 200,
        "data": {
            "taskId": "task-invalid",
            "state": "success",
            "info": {},
            "resultJson": "{not-json}",
        },
    }
    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"


@pytest.mark.anyio
async def test_sora_webhook_legacy_result_urls_string_list(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)

    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {
        "code": 200,
        "data": {
            "taskId": "task-string",
            "state": "success",
            "info": {"resultUrls": json.dumps(["https://example.com/a.mp4"])},
        },
    }
    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.anyio
async def test_sora_webhook_db_dispatcher_success(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    await _create_clip_manifest_mapping(run_id, {"task-db-ok": {"videoIndex": 0}})

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {
        "code": 200,
        "data": {
            "taskId": "task-db-ok",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/v.mp4"]},
        },
    }

    resp = await async_client.post(f"/v1/webhooks/sora?run_id={run_id}", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.anyio
async def test_remotion_webhook_db_dispatcher_success(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    run_id = await _create_run(status=RunStatus.AWAITING_RENDER.value)
    await _create_editor_output_with_job_id(run_id, "job-db")

    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    payload = json.dumps(
        {"status": "done", "output_url": "https://cdn.example/final.mp4", "job_id": "job-db"}
    ).encode()
    digest = hmac.new(b"secret", payload, hashlib.sha512).hexdigest()

    resp = await async_client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        content=payload,
        headers={"X-Remotion-Signature": f"sha512={digest}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"
