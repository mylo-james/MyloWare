from __future__ import annotations

import hashlib
import hmac
import json
import sys
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException, Request

from myloware.api.routes import webhooks
from myloware.config.settings import settings
from myloware.storage.models import ArtifactType, RunStatus


def _make_request(
    body: bytes, *, query: str = "", headers: dict[str, str] | None = None, path: str
) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "query_string": query.encode(),
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    }

    async def receive():  # type: ignore[no-untyped-def]
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


def _remotion_signature(secret: str, payload: bytes) -> str:
    digest = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()
    return f"sha512={digest}"


class FakeSession:
    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True


class FakeRun:
    def __init__(self, status: str) -> None:
        self.status = status


class FakeRunRepo:
    def __init__(self, run: FakeRun | None = None, run_for_update: FakeRun | None = None) -> None:
        self._run = run
        self._run_for_update = run_for_update if run_for_update is not None else run
        self.session = FakeSession()
        self.updated = []

    async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
        return self._run

    async def get_for_update_async(self, _run_id):  # type: ignore[no-untyped-def]
        return self._run_for_update

    async def update_async(self, _run_id, **kwargs):  # type: ignore[no-untyped-def]
        self.updated.append(kwargs)

    async def add_artifact_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
        return None


class FakeArtifact:
    def __init__(
        self,
        artifact_type: str,
        metadata: dict[str, object] | None = None,
        *,
        uri: str | None = None,
        content: str | None = None,
    ) -> None:
        self.artifact_type = artifact_type
        self.artifact_metadata = metadata
        self.uri = uri
        self.content = content


class FakeArtifactRepo:
    def __init__(
        self,
        artifacts: list[FakeArtifact] | None = None,
        *,
        mapping_run_id: str | None = None,
        mapping_meta: dict[str, object] | None = None,
    ) -> None:
        self._artifacts = artifacts or []
        self._mapping_run_id = mapping_run_id
        self._mapping_meta = mapping_meta

    async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
        return self._artifacts

    async def create_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
        return None

    async def find_run_for_sora_task_async(self, _task_id):  # type: ignore[no-untyped-def]
        if self._mapping_run_id and self._mapping_meta:
            return uuid4(), self._mapping_meta
        return None


@pytest.mark.anyio
async def test_sora_standard_event_missing_mapping_in_test_mode_raises(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-404"}}
    req = _make_request(json.dumps(payload).encode(), path="/v1/webhooks/sora")

    with pytest.raises(HTTPException) as exc:
        await webhooks.sora_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(),
            artifact_repo=FakeArtifactRepo(),
        )
    assert exc.value.status_code == 400


@pytest.mark.anyio
async def test_sora_legacy_result_urls_invalid_json(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    run_id = uuid4()
    payload = {
        "code": 200,
        "data": {"taskId": "task-1", "state": "success", "info": {"resultUrls": "not-json"}},
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    resp = await webhooks.sora_webhook(
        req, BackgroundTasks(), run_repo=FakeRunRepo(), artifact_repo=FakeArtifactRepo()
    )
    assert resp["status"] == "accepted"
    assert resp["video_url"] == "not-json"


@pytest.mark.anyio
async def test_sora_legacy_result_urls_json_string(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    run_id = uuid4()
    payload = {
        "code": 200,
        "data": {
            "taskId": "task-2",
            "state": "success",
            "info": {"resultUrls": json.dumps("https://example.com/v.mp4")},
        },
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    resp = await webhooks.sora_webhook(
        req, BackgroundTasks(), run_repo=FakeRunRepo(), artifact_repo=FakeArtifactRepo()
    )
    assert resp["status"] == "accepted"
    assert resp["video_url"] == "https://example.com/v.mp4"


@pytest.mark.anyio
async def test_sora_legacy_result_urls_json_number_fast_path_error(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "sora_provider", "fake")

    run_id = uuid4()
    payload = {
        "code": 200,
        "data": {"taskId": "task-3", "state": "success", "info": {"resultUrls": "123"}},
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    resp = await webhooks.sora_webhook(
        req, BackgroundTasks(), run_repo=FakeRunRepo(), artifact_repo=FakeArtifactRepo()
    )
    assert resp["status"] == "error"


@pytest.mark.anyio
async def test_sora_unknown_task_id_ignored_in_real_processing(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    run_id = uuid4()
    payload = {
        "code": 200,
        "data": {"taskId": "task-ignored", "state": "success"},
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    resp = await webhooks.sora_webhook(
        req, BackgroundTasks(), run_repo=FakeRunRepo(), artifact_repo=FakeArtifactRepo()
    )
    assert resp["status"] == "ignored"


@pytest.mark.anyio
async def test_sora_db_dispatcher_rolls_back_on_duplicate(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    run_id = uuid4()
    manifest = FakeArtifact(
        ArtifactType.CLIP_MANIFEST.value,
        metadata={"type": "task_metadata_mapping", "task_count": 1},
        content=json.dumps({"task-db": {"videoIndex": 0}}),
    )
    artifact_repo = FakeArtifactRepo([manifest])
    run_repo = FakeRunRepo()

    class FakeJobRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def enqueue_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            raise ValueError("duplicate")

    monkeypatch.setattr(webhooks, "JobRepository", FakeJobRepo)

    payload = {
        "code": 200,
        "data": {"taskId": "task-db", "state": "success", "info": {"resultUrls": ["x"]}},
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    resp = await webhooks.sora_webhook(
        req, BackgroundTasks(), run_repo=run_repo, artifact_repo=artifact_repo
    )
    assert resp["status"] == "accepted"
    assert run_repo.session.rolled_back is True


@pytest.mark.anyio
async def test_sora_download_failure_marks_failed(monkeypatch) -> None:
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

    monkeypatch.setattr(webhooks, "download_openai_video_content_to_tempfile", fake_download)

    run_id = uuid4()
    manifest = FakeArtifact(
        ArtifactType.CLIP_MANIFEST.value,
        metadata={"type": "task_metadata_mapping", "task_count": 1},
        content=json.dumps({"task-dl": {"videoIndex": 0}}),
    )
    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-dl"}}
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    resp = await webhooks.sora_webhook(
        req,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo([manifest]),
    )
    assert resp["status"] == "error"


@pytest.mark.anyio
async def test_sora_download_cleanup_logs_on_unlink_failure(monkeypatch) -> None:
    class FakeOpenAI:
        def __init__(self, *_a, **_k):
            self.webhooks = SimpleNamespace(verify_signature=lambda **_kw: None)

    class FakePath:
        def as_uri(self) -> str:
            return "file:///tmp/fake.mp4"

        def unlink(self, missing_ok: bool = False) -> None:  # noqa: ARG002
            raise RuntimeError("unlink failed")

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setattr(settings, "openai_standard_webhook_secret", "secret")
    monkeypatch.setattr(settings, "openai_api_key", "key")
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    async def fake_download(_task_id: str):
        return FakePath()

    async def fake_transcode(_url: str, _run_id, _video_index: int):
        return None

    monkeypatch.setattr(webhooks, "download_openai_video_content_to_tempfile", fake_download)
    monkeypatch.setattr(webhooks, "transcode_video", fake_transcode)

    run_id = uuid4()
    manifest = FakeArtifact(
        ArtifactType.CLIP_MANIFEST.value,
        metadata={"type": "task_metadata_mapping", "task_count": 1},
        content=json.dumps({"task-clean": {"videoIndex": 0}}),
    )
    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-clean"}}
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    resp = await webhooks.sora_webhook(
        req,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo([manifest]),
    )
    assert resp["status"] == "error"


@pytest.mark.anyio
async def test_sora_run_missing_after_clip_save(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    async def fake_transcode(_url: str, _run_id, _video_index: int):
        return "https://cdn.example/transcoded.mp4"

    monkeypatch.setattr(webhooks, "transcode_video", fake_transcode)

    run_id = uuid4()
    manifest = FakeArtifact(
        ArtifactType.CLIP_MANIFEST.value,
        metadata={"type": "task_metadata_mapping", "task_count": 1},
        content=json.dumps({"task-miss": {"videoIndex": 0}}),
    )
    payload = {
        "code": 200,
        "data": {
            "taskId": "task-miss",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/original.mp4"]},
        },
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    with pytest.raises(HTTPException):
        await webhooks.sora_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(run_for_update=None),
            artifact_repo=FakeArtifactRepo([manifest]),
        )


@pytest.mark.anyio
async def test_sora_all_clips_ready_run_failed_skips_resume(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    async def fake_transcode(_url: str, _run_id, _video_index: int):
        return "https://cdn.example/transcoded.mp4"

    monkeypatch.setattr(webhooks, "transcode_video", fake_transcode)

    async def ready_count(*_a, **_k):  # type: ignore[no-untyped-def]
        return 1

    async def expected_count(*_a, **_k):  # type: ignore[no-untyped-def]
        return 1

    monkeypatch.setattr(webhooks, "_ready_clip_count_async", ready_count)
    monkeypatch.setattr(webhooks, "_expected_clip_count_async", expected_count)

    run_id = uuid4()
    manifest = FakeArtifact(
        ArtifactType.CLIP_MANIFEST.value,
        metadata={"type": "task_metadata_mapping", "task_count": 1},
        content=json.dumps({"task-failed": {"videoIndex": 0}}),
    )
    payload = {
        "code": 200,
        "data": {
            "taskId": "task-failed",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/original.mp4"]},
        },
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    run_repo = FakeRunRepo(run=FakeRun(RunStatus.FAILED.value))
    resp = await webhooks.sora_webhook(
        req,
        BackgroundTasks(),
        run_repo=run_repo,
        artifact_repo=FakeArtifactRepo([manifest]),
    )
    assert resp["status"] == "accepted"
    assert run_repo.session.committed is True


@pytest.mark.anyio
async def test_sora_not_all_clips_ready_commits(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "sora_provider", "fake")

    async def fake_transcode(_url: str, _run_id, _video_index: int):
        return "https://cdn.example/transcoded.mp4"

    monkeypatch.setattr(webhooks, "transcode_video", fake_transcode)

    async def ready_count(*_a, **_k):  # type: ignore[no-untyped-def]
        return 0

    async def expected_count(*_a, **_k):  # type: ignore[no-untyped-def]
        return 2

    monkeypatch.setattr(webhooks, "_ready_clip_count_async", ready_count)
    monkeypatch.setattr(webhooks, "_expected_clip_count_async", expected_count)

    run_id = uuid4()
    manifest = FakeArtifact(
        ArtifactType.CLIP_MANIFEST.value,
        metadata={"type": "task_metadata_mapping", "task_count": 2},
        content=json.dumps({"task-pending": {"videoIndex": 0}}),
    )
    payload = {
        "code": 200,
        "data": {
            "taskId": "task-pending",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/original.mp4"]},
        },
    }
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/sora",
    )

    run_repo = FakeRunRepo(run=FakeRun(RunStatus.AWAITING_VIDEO_GENERATION.value))
    resp = await webhooks.sora_webhook(
        req,
        BackgroundTasks(),
        run_repo=run_repo,
        artifact_repo=FakeArtifactRepo([manifest]),
    )
    assert resp["status"] == "accepted"
    assert run_repo.session.committed is True


@pytest.mark.anyio
async def test_remotion_run_not_found_raises(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    run_id = uuid4()
    payload = {"status": "done", "output_url": "https://example.com/out.mp4"}
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )

    with pytest.raises(HTTPException) as exc:
        await webhooks.remotion_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(run=None),
            artifact_repo=FakeArtifactRepo(),
        )
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_remotion_wrong_status_rejected(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    run_id = uuid4()
    payload = {"status": "done", "output_url": "https://example.com/out.mp4", "job_id": "job-1"}
    body = json.dumps(payload).encode()
    req = _make_request(
        body,
        query=f"run_id={run_id}",
        headers={"X-Remotion-Signature": _remotion_signature("secret", body)},
        path="/v1/webhooks/remotion",
    )

    with pytest.raises(HTTPException) as exc:
        await webhooks.remotion_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(run=FakeRun(RunStatus.RUNNING.value)),
            artifact_repo=FakeArtifactRepo(),
        )
    assert exc.value.status_code == 400


@pytest.mark.anyio
async def test_remotion_invalid_json_rejected(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    run_id = uuid4()
    req = _make_request(b"not-json", query=f"run_id={run_id}", path="/v1/webhooks/remotion")

    with pytest.raises(HTTPException) as exc:
        await webhooks.remotion_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value)),
            artifact_repo=FakeArtifactRepo(),
        )
    assert exc.value.status_code == 400


@pytest.mark.anyio
async def test_remotion_fast_path_missing_output_url(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    run_id = uuid4()
    payload = {"status": "done"}
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )

    with pytest.raises(HTTPException) as exc:
        await webhooks.remotion_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value)),
            artifact_repo=FakeArtifactRepo(),
        )
    assert exc.value.status_code == 400


@pytest.mark.anyio
async def test_remotion_fast_path_error(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    run_id = uuid4()
    payload = {"status": "error", "error": "boom"}
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )

    resp = await webhooks.remotion_webhook(
        req,
        BackgroundTasks(),
        run_repo=FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value)),
        artifact_repo=FakeArtifactRepo(),
    )
    assert resp.status == "error"


@pytest.mark.anyio
async def test_remotion_unknown_job_id_rejected(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "remotion_webhook_secret", "secret")

    run_id = uuid4()
    payload = {"status": "done", "output_url": "https://example.com/out.mp4", "job_id": "job-404"}
    body = json.dumps(payload).encode()
    req = _make_request(
        body,
        query=f"run_id={run_id}",
        headers={"X-Remotion-Signature": _remotion_signature("secret", body)},
        path="/v1/webhooks/remotion",
    )

    with pytest.raises(HTTPException) as exc:
        await webhooks.remotion_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value)),
            artifact_repo=FakeArtifactRepo(),
        )
    assert exc.value.status_code == 400


@pytest.mark.anyio
async def test_remotion_idempotent_returns_existing_artifact(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "remotion_provider", "fake")
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")

    run_id = uuid4()
    rendered = FakeArtifact(
        ArtifactType.RENDERED_VIDEO.value,
        metadata={"render_job_id": "job-1"},
        uri="https://cdn.example/final.mp4",
    )
    payload = {"status": "done", "output_url": "ignored", "job_id": "job-1"}
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )

    resp = await webhooks.remotion_webhook(
        req,
        BackgroundTasks(),
        run_repo=FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value)),
        artifact_repo=FakeArtifactRepo([rendered]),
    )
    assert resp["status"] == "accepted"
    assert resp["output_url"] == "https://cdn.example/final.mp4"


@pytest.mark.anyio
async def test_remotion_db_dispatcher_rolls_back(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    class FakeJobRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def enqueue_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            raise ValueError("duplicate")

    monkeypatch.setattr(webhooks, "JobRepository", FakeJobRepo)

    run_id = uuid4()
    payload = {"status": "done", "output_url": "https://example.com/out.mp4", "job_id": "job-db"}
    req = _make_request(
        json.dumps(payload).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )

    run_repo = FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value))
    resp = await webhooks.remotion_webhook(
        req,
        BackgroundTasks(),
        run_repo=run_repo,
        artifact_repo=FakeArtifactRepo(),
    )
    assert resp["status"] == "accepted"
    assert run_repo.session.rolled_back is True


@pytest.mark.anyio
async def test_remotion_error_and_pending_paths(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    run_id = uuid4()
    error_req = _make_request(
        json.dumps({"status": "error", "error": "boom", "job_id": "job-1"}).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )
    run_repo = FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value))
    error_resp = await webhooks.remotion_webhook(
        error_req,
        BackgroundTasks(),
        run_repo=run_repo,
        artifact_repo=FakeArtifactRepo(),
    )
    assert error_resp.status == "error"

    pending_req = _make_request(
        json.dumps({"status": "processing", "job_id": "job-2"}).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )
    pending_resp = await webhooks.remotion_webhook(
        pending_req,
        BackgroundTasks(),
        run_repo=FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value)),
        artifact_repo=FakeArtifactRepo(),
    )
    assert pending_resp.status == "processing"


@pytest.mark.anyio
async def test_remotion_missing_output_url_in_processing_mode(monkeypatch) -> None:
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    monkeypatch.setattr(settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(settings, "remotion_provider", "fake")

    run_id = uuid4()
    req = _make_request(
        json.dumps({"status": "done", "job_id": "job-3"}).encode(),
        query=f"run_id={run_id}",
        path="/v1/webhooks/remotion",
    )

    with pytest.raises(HTTPException) as exc:
        await webhooks.remotion_webhook(
            req,
            BackgroundTasks(),
            run_repo=FakeRunRepo(run=FakeRun(RunStatus.AWAITING_RENDER.value)),
            artifact_repo=FakeArtifactRepo(),
        )
    assert exc.value.status_code == 400
