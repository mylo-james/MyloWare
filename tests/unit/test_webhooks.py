"""Tests for external service webhooks."""

import hashlib
import hmac
import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import Request
from fastapi.testclient import TestClient


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


@pytest.fixture
def client():
    from myloware.api.routes import webhooks
    from myloware.api.server import app

    previous_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[webhooks.get_async_run_repo] = lambda: DummyAsyncRunRepo()
    app.dependency_overrides[webhooks.get_async_artifact_repo] = lambda: DummyAsyncArtifactRepo()

    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        test_client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)


@contextmanager
def _fake_session():
    yield MagicMock()


class DummyAsyncRunRepo:
    def __init__(self):
        class _Session:
            async def commit(self): ...

        self.session = _Session()
        self._status = "awaiting_render"

    async def create_async(self, *_args, **_kwargs):
        # Used by async startup paths; return a dummy run object
        run = MagicMock()
        run.id = _kwargs.get("id") if _kwargs else None
        return run

    async def get_async(self, *_args, **_kwargs):
        run = MagicMock()
        run.status = self._status
        run.id = _args[0] if _args else None
        run.artifacts = {}
        return run

    async def get_for_update_async(self, *_args, **_kwargs):
        run = MagicMock()
        run.status = "awaiting_video_generation"
        return run

    async def update_async(self, *_args, **_kwargs):
        return None

    def update(self, *_args, **_kwargs):
        return None

    async def add_artifact_async(self, *_args, **_kwargs):
        return None


class DummyAsyncArtifactRepo:
    async def create_async(self, *_args, **_kwargs):
        return None

    async def get_by_run_async(self, *_args, **_kwargs):
        return []

    def create(self, *_args, **_kwargs):
        return None

    def get_by_run(self, *_args, **_kwargs):
        return []


class TestSoraWebhook:
    """Tests for Sora video generation webhook."""

    def test_valid_sora_callback(self, client):
        run_id = "00000000-0000-0000-0000-000000000123"
        with (
            patch("myloware.api.routes.webhooks.get_session", _fake_session, create=True),
            patch("myloware.api.routes.webhooks.get_async_run_repo", lambda: DummyAsyncRunRepo()),
            patch(
                "myloware.api.routes.webhooks.get_async_artifact_repo",
                lambda: DummyAsyncArtifactRepo(),
            ),
            patch("myloware.api.routes.webhooks.settings") as mock_settings,
        ):
            mock_settings.sora_provider = "fake"
            mock_settings.openai_sora_signing_secret = ""
            mock_settings.openai_standard_webhook_secret = ""
            mock_settings.disable_background_workflows = True

            response = client.post(
                f"/v1/webhooks/sora?run_id={run_id}",
                json={
                    "code": 200,
                    "msg": "success",
                    "data": {
                        "taskId": "task-abc",
                        "info": {"resultUrls": ["https://cdn.openai sora/video.mp4"]},
                    },
                    "metadata": {"videoIndex": 0},
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "accepted"
            assert data["run_id"] == run_id

    def test_sora_missing_run_id(self, client):
        with patch("myloware.api.routes.webhooks.settings") as mock_settings:
            mock_settings.sora_provider = "fake"
            mock_settings.openai_sora_signing_secret = ""
            mock_settings.openai_standard_webhook_secret = ""
            mock_settings.disable_background_workflows = True

            response = client.post(
                "/v1/webhooks/sora",
                json={
                    "code": 200,
                    "data": {"taskId": "task-abc"},
                },
            )

            assert response.status_code == 400

    def test_sora_invalid_json(self, client):
        with patch("myloware.api.routes.webhooks.settings") as mock_settings:
            mock_settings.sora_provider = "fake"
            mock_settings.openai_sora_signing_secret = ""
            mock_settings.openai_standard_webhook_secret = ""
            mock_settings.disable_background_workflows = True

            response = client.post(
                "/v1/webhooks/sora?run_id=00000000-0000-0000-0000-000000000123",
                content="not json",
                headers={"Content-Type": "application/json"},
            )

            assert response.status_code == 400


class TestRemotionWebhook:
    """Tests for Remotion render webhook."""

    def test_valid_remotion_callback(self, client):
        run_id = "00000000-0000-0000-0000-000000000999"
        with (
            patch("myloware.api.routes.webhooks.get_session", _fake_session, create=True),
            patch("myloware.api.routes.webhooks.get_async_run_repo", lambda: DummyAsyncRunRepo()),
            patch(
                "myloware.api.routes.webhooks.get_async_artifact_repo",
                lambda: DummyAsyncArtifactRepo(),
            ),
            patch("myloware.api.routes.webhooks.settings") as mock_settings,
        ):
            mock_settings.remotion_webhook_secret = ""
            mock_settings.remotion_provider = "fake"
            mock_settings.disable_background_workflows = True

            response = client.post(
                f"/v1/webhooks/remotion?run_id={run_id}",
                json={
                    "job_id": "job-1",
                    "status": "done",
                    "output_url": "https://render.local/output/job-1.mp4",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "accepted"
            assert data["run_id"] == run_id

    def test_remotion_missing_run_id(self, client):
        with patch("myloware.api.routes.webhooks.settings") as mock_settings:
            mock_settings.remotion_webhook_secret = ""
            mock_settings.remotion_provider = "fake"
            mock_settings.disable_background_workflows = True

            response = client.post(
                "/v1/webhooks/remotion",
                json={"job_id": "job-2", "status": "done", "output_url": "https://render"},
            )

            assert response.status_code == 400


def test_parse_video_urls_variants():
    from myloware.api.routes import webhooks as webhooks_mod

    assert webhooks_mod._parse_video_urls({"resultUrls": '["a","b"]'}) == ["a", "b"]
    assert webhooks_mod._parse_video_urls({"resultUrls": "solo"}) == ["solo"]
    assert webhooks_mod._parse_video_urls({"resultUrls": ["x"]}) == ["x"]
    assert webhooks_mod._parse_video_urls({"videoUrl": "v"}) == ["v"]


def test_verify_webhook_signature_skips_in_fake_mode(monkeypatch):
    from myloware.api.routes import webhooks as webhooks_mod

    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")
    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", True)
    assert (
        webhooks_mod._verify_webhook_signature(
            payload=b"{}", signature=None, secret="", source="sora"
        )
        is True
    )


def test_verify_webhook_signature_skips_in_fake_mode_remotion(monkeypatch):
    from myloware.api.routes import webhooks as webhooks_mod

    monkeypatch.setattr(webhooks_mod.settings, "remotion_provider", "fake")
    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", True)
    assert (
        webhooks_mod._verify_webhook_signature(
            payload=b"{}", signature=None, secret="", source="remotion"
        )
        is True
    )


def test_verify_webhook_signature_raises_without_secret_in_real_mode(monkeypatch):
    from fastapi import HTTPException
    from myloware.api.routes import webhooks as webhooks_mod

    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "real")
    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    with pytest.raises(HTTPException):
        webhooks_mod._verify_webhook_signature(
            payload=b"{}", signature=None, secret="", source="sora"
        )


def test_verify_webhook_signature_validates_digest(monkeypatch):
    from myloware.api.routes import webhooks as webhooks_mod

    payload = b"payload"
    secret = "secret"
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    assert (
        webhooks_mod._verify_webhook_signature(
            payload=payload,
            signature=f"sha256={digest}",
            secret=secret,
            source="sora",
        )
        is True
    )


def test_verify_webhook_signature_missing_signature(monkeypatch):
    from myloware.api.routes import webhooks as webhooks_mod

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    assert (
        webhooks_mod._verify_webhook_signature(
            payload=b"{}", signature=None, secret="s", source="sora"
        )
        is False
    )


def test_verify_webhook_signature_unsupported_algorithm(monkeypatch):
    from myloware.api.routes import webhooks as webhooks_mod

    assert (
        webhooks_mod._verify_webhook_signature(
            payload=b"{}", signature="x", secret="s", source="sora", algorithm="sha1"
        )
        is False
    )


def test_get_first_header_picks_first_non_empty():
    from myloware.api.routes import webhooks as webhooks_mod
    from fastapi import Request

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-a", b""), (b"x-b", b"val")],
    }
    request = Request(scope)
    assert webhooks_mod._get_first_header(request, ["x-a", "x-b"]) == "val"


def test_parse_run_id_invalid_raises():
    from fastapi import HTTPException
    from myloware.api.routes import webhooks as webhooks_mod

    with pytest.raises(HTTPException):
        webhooks_mod._parse_run_id("not-a-uuid")


@pytest.mark.asyncio
async def test_expected_and_ready_clip_counts():
    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.storage.models import ArtifactType
    from types import SimpleNamespace

    class Repo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return [
                SimpleNamespace(
                    artifact_type=ArtifactType.CLIP_MANIFEST.value,
                    artifact_metadata={"type": "task_metadata_mapping", "task_count": 3},
                ),
                SimpleNamespace(artifact_type=ArtifactType.VIDEO_CLIP.value),
                SimpleNamespace(artifact_type=ArtifactType.VIDEO_CLIP.value),
            ]

    repo = Repo()
    expected = await webhooks_mod._expected_clip_count_async(repo, run_id=uuid.uuid4())
    ready = await webhooks_mod._ready_clip_count_async(repo, run_id=uuid.uuid4())
    assert expected == 3
    assert ready == 2


@pytest.mark.asyncio
async def test_expected_clip_count_defaults_when_no_manifest():
    from myloware.api.routes import webhooks as webhooks_mod

    class Repo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return []

    expected = await webhooks_mod._expected_clip_count_async(Repo(), run_id=uuid.uuid4())
    assert expected == 1


@pytest.mark.asyncio
async def test_expected_clip_count_handles_bad_task_count():
    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.storage.models import ArtifactType
    from types import SimpleNamespace

    class Repo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return [
                SimpleNamespace(
                    artifact_type=ArtifactType.CLIP_MANIFEST.value,
                    artifact_metadata={"type": "task_metadata_mapping", "task_count": "nope"},
                )
            ]

    expected = await webhooks_mod._expected_clip_count_async(Repo(), run_id=uuid.uuid4())
    assert expected == 1


@pytest.mark.asyncio
async def test_lookup_task_metadata_handles_exception():
    from myloware.api.routes import webhooks as webhooks_mod

    class Repo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            raise RuntimeError("db down")

    result = await webhooks_mod._lookup_task_metadata(Repo(), uuid.uuid4(), "task-1")
    assert result is None


@pytest.mark.asyncio
async def test_update_run_after_render_uses_latest_render(monkeypatch):
    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.storage.models import ArtifactType, RunStatus
    from types import SimpleNamespace

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    run_updates: dict[str, object] = {}

    class FakeRunRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def add_artifact_async(self, run_id, key, value):  # type: ignore[no-untyped-def]
            run_updates[key] = value

        async def update_async(self, run_id, **kwargs):  # type: ignore[no-untyped-def]
            run_updates.update(kwargs)

    class FakeArtifactRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return [
                SimpleNamespace(
                    artifact_type=ArtifactType.RENDERED_VIDEO.value,
                    uri="https://cdn.example/final.mp4",
                )
            ]

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr(webhooks_mod, "RunRepository", lambda _s: FakeRunRepo(_s))
    monkeypatch.setattr(webhooks_mod, "ArtifactRepository", lambda _s: FakeArtifactRepo(_s))

    await webhooks_mod._update_run_after_render(uuid.uuid4())
    assert run_updates["status"] == RunStatus.AWAITING_PUBLISH_APPROVAL.value
    assert run_updates["video"] == "https://cdn.example/final.mp4"


def test_sora_webhook_idempotent_already_processed(monkeypatch):
    from types import SimpleNamespace

    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.api.server import app
    from myloware.storage.models import ArtifactType

    class ArtifactRepoWithClip(DummyAsyncArtifactRepo):
        async def get_by_run_async(self, *_args, **_kwargs):
            return [
                SimpleNamespace(
                    artifact_type=ArtifactType.VIDEO_CLIP.value,
                    artifact_metadata={"task_id": "task-dup"},
                )
            ]

    previous_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[webhooks_mod.get_async_run_repo] = lambda: DummyAsyncRunRepo()
    app.dependency_overrides[webhooks_mod.get_async_artifact_repo] = lambda: ArtifactRepoWithClip()

    test_client = None
    try:
        test_client = TestClient(app)
        monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", True)
        monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")
        monkeypatch.setattr(webhooks_mod.settings, "openai_sora_signing_secret", "")
        monkeypatch.setattr(webhooks_mod.settings, "openai_standard_webhook_secret", "")

        resp = test_client.post(
            "/v1/webhooks/sora?run_id=00000000-0000-0000-0000-000000000123",
            json={
                "code": 200,
                "msg": "success",
                "data": {
                    "taskId": "task-dup",
                    "info": {"resultUrls": ["https://cdn.example/v.mp4"]},
                },
            },
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["status"] == "accepted"
        assert payload.get("task_id") == "task-dup"
    finally:
        if test_client is not None:
            test_client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)


@pytest.mark.asyncio
async def test_lookup_task_metadata_returns_none_when_missing():
    import json

    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.storage.models import ArtifactType

    class FakeArtifact:
        artifact_type = ArtifactType.CLIP_MANIFEST.value
        artifact_metadata = {"type": "task_metadata_mapping"}
        content = json.dumps({"task-1": {"video_index": 0}})

    class FakeRepo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return [FakeArtifact()]

    result = await webhooks_mod._lookup_task_metadata(FakeRepo(), uuid.UUID(int=1), "task-2")
    assert result is None


@pytest.mark.asyncio
async def test_sora_webhook_standard_event_direct_success(monkeypatch):
    import json
    from types import SimpleNamespace

    from starlette.background import BackgroundTasks

    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.storage.models import ArtifactType, RunStatus

    run_id = uuid.uuid4()
    mapping = {"task-1": {"videoIndex": 0, "topic": "t", "sign": "s", "object_name": "o"}}

    manifest = SimpleNamespace(
        artifact_type=ArtifactType.CLIP_MANIFEST.value,
        artifact_metadata={"type": "task_metadata_mapping", "task_count": 1},
        content=json.dumps(mapping),
    )

    class FakeArtifactRepo:
        def __init__(self):
            self.artifacts = [manifest]

        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return list(self.artifacts)

        async def create_async(self, **kwargs):  # type: ignore[no-untyped-def]
            self.artifacts.append(
                SimpleNamespace(
                    artifact_type=kwargs.get("artifact_type"),
                    artifact_metadata=kwargs.get("metadata") or {},
                    uri=kwargs.get("uri"),
                    content=kwargs.get("content"),
                )
            )

        async def find_run_for_sora_task_async(self, task_id):  # type: ignore[no-untyped-def]
            meta = mapping.get(task_id)
            return (run_id, meta) if meta else None

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

        async def rollback(self):  # type: ignore[no-untyped-def]
            return None

    class FakeRun:
        def __init__(self):
            self.status = RunStatus.AWAITING_VIDEO_GENERATION.value
            self.current_step = None
            self.error = None

    class FakeRunRepo:
        def __init__(self):
            self.session = FakeSession()
            self.updated: list[dict[str, object]] = []
            self._run = FakeRun()

        async def update_async(self, _run_id, **kwargs):  # type: ignore[no-untyped-def]
            self.updated.append(kwargs)
            if "status" in kwargs:
                self._run.status = kwargs["status"]

        async def get_for_update_async(self, _run_id):  # type: ignore[no-untyped-def]
            return self._run

    async def fake_transcode(_url, _run_id, _video_index):  # type: ignore[no-untyped-def]
        return "https://cdn.example/transcoded.mp4"

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    monkeypatch.setattr(webhooks_mod.settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")
    monkeypatch.setattr(webhooks_mod.settings, "webhook_base_url", "http://base")
    monkeypatch.setattr(webhooks_mod, "transcode_video", fake_transcode)

    payload = {
        "object": "event",
        "type": "video.completed",
        "data": {"id": "evt_1", "object": "video", "video_id": "task-1"},
    }
    request = _make_request(json.dumps(payload).encode(), path="/v1/webhooks/sora")
    resp = await webhooks_mod.sora_webhook(
        request,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo(),
    )

    assert resp["status"] == "accepted"
    assert resp["video_index"] == 0


@pytest.mark.asyncio
async def test_sora_webhook_unknown_task_id_no_mapping_direct(monkeypatch):
    import json

    from starlette.background import BackgroundTasks

    from myloware.api.routes import webhooks as webhooks_mod

    class FakeRunRepo:
        class _Session:
            async def commit(self):  # type: ignore[no-untyped-def]
                return None

            async def rollback(self):  # type: ignore[no-untyped-def]
                return None

        session = _Session()

    class FakeArtifactRepo:
        async def find_run_for_sora_task_async(self, _task_id):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    monkeypatch.setattr(webhooks_mod.settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")

    payload = {"object": "event", "type": "video.completed", "data": {"id": "task-missing"}}
    request = _make_request(json.dumps(payload).encode(), path="/v1/webhooks/sora")
    resp = await webhooks_mod.sora_webhook(
        request,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo(),
    )
    assert resp["status"] == "ignored"


@pytest.mark.asyncio
async def test_sora_webhook_legacy_result_json_dict_direct(monkeypatch):
    import json

    from starlette.background import BackgroundTasks

    from myloware.api.routes import webhooks as webhooks_mod

    class FakeRunRepo:
        class _Session:
            async def commit(self):  # type: ignore[no-untyped-def]
                return None

            async def rollback(self):  # type: ignore[no-untyped-def]
                return None

        session = _Session()

    class FakeArtifactRepo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return []

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", True)
    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")

    payload = {
        "code": 200,
        "data": {
            "taskId": "task-legacy",
            "state": "success",
            "info": {"resultUrls": json.dumps(["https://example.com/a.mp4"])},
            "resultJson": {"resultUrls": ["https://example.com/a.mp4"]},
        },
    }
    request = _make_request(
        json.dumps(payload).encode(),
        query="run_id=00000000-0000-0000-0000-000000000123",
        path="/v1/webhooks/sora",
    )
    resp = await webhooks_mod.sora_webhook(
        request,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo(),
    )
    assert resp["status"] == "accepted"


@pytest.mark.asyncio
async def test_sora_webhook_progress_direct(monkeypatch):
    import json

    from starlette.background import BackgroundTasks

    from myloware.api.routes import webhooks as webhooks_mod

    class FakeRunRepo:
        class _Session:
            async def commit(self):  # type: ignore[no-untyped-def]
                return None

            async def rollback(self):  # type: ignore[no-untyped-def]
                return None

        session = _Session()

    class FakeArtifactRepo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return []

    async def fake_lookup(*_a, **_k):  # type: ignore[no-untyped-def]
        return {"videoIndex": 0}

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    monkeypatch.setattr(webhooks_mod.settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")
    monkeypatch.setattr(webhooks_mod, "_lookup_task_metadata", fake_lookup)

    payload = {
        "code": 200,
        "data": {"taskId": "task-progress", "state": "success", "info": {}},
    }
    request = _make_request(
        json.dumps(payload).encode(),
        query="run_id=00000000-0000-0000-0000-000000000123",
        path="/v1/webhooks/sora",
    )
    resp = await webhooks_mod.sora_webhook(
        request,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo(),
    )
    assert resp["status"] == "pending"


@pytest.mark.asyncio
async def test_sora_webhook_db_dispatcher_direct(monkeypatch):
    import json

    from starlette.background import BackgroundTasks

    from myloware.api.routes import webhooks as webhooks_mod

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

        async def rollback(self):  # type: ignore[no-untyped-def]
            return None

    class FakeRunRepo:
        def __init__(self):
            self.session = FakeSession()

    class FakeArtifactRepo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return []

    class FakeJobRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def enqueue_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return None

    async def fake_lookup(*_a, **_k):  # type: ignore[no-untyped-def]
        return {"videoIndex": 0}

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    monkeypatch.setattr(webhooks_mod.settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")
    monkeypatch.setattr(webhooks_mod, "_lookup_task_metadata", fake_lookup)
    monkeypatch.setattr(webhooks_mod, "JobRepository", FakeJobRepo)

    payload = {
        "code": 200,
        "data": {
            "taskId": "task-db",
            "state": "success",
            "info": {"resultUrls": ["https://example.com/a.mp4"]},
        },
    }
    request = _make_request(
        json.dumps(payload).encode(),
        query="run_id=00000000-0000-0000-0000-000000000123",
        path="/v1/webhooks/sora",
    )
    resp = await webhooks_mod.sora_webhook(
        request,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo(),
    )
    assert resp["status"] == "accepted"


@pytest.mark.asyncio
async def test_sora_webhook_missing_video_url_direct(monkeypatch):
    import json

    from starlette.background import BackgroundTasks

    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.storage.models import RunStatus

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

        async def rollback(self):  # type: ignore[no-untyped-def]
            return None

    class FakeRunRepo:
        def __init__(self):
            self.session = FakeSession()

        async def update_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return None

        async def get_for_update_async(self, _run_id):  # type: ignore[no-untyped-def]
            return SimpleNamespace(status=RunStatus.AWAITING_VIDEO_GENERATION.value)

    class FakeArtifactRepo:
        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return []

    async def fake_lookup(*_a, **_k):  # type: ignore[no-untyped-def]
        return {"videoIndex": 0}

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    monkeypatch.setattr(webhooks_mod.settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(webhooks_mod.settings, "sora_provider", "fake")
    monkeypatch.setattr(webhooks_mod.settings, "webhook_base_url", "")
    monkeypatch.setattr(webhooks_mod, "_lookup_task_metadata", fake_lookup)

    payload = {
        "object": "event",
        "type": "video.completed",
        "data": {"id": "task-miss"},
    }
    request = _make_request(
        json.dumps(payload).encode(),
        query="run_id=00000000-0000-0000-0000-000000000123",
        path="/v1/webhooks/sora",
    )
    resp = await webhooks_mod.sora_webhook(
        request,
        BackgroundTasks(),
        run_repo=FakeRunRepo(),
        artifact_repo=FakeArtifactRepo(),
    )
    assert resp["status"] == "error"


@pytest.mark.asyncio
async def test_remotion_webhook_direct_success(monkeypatch):
    import json
    from types import SimpleNamespace

    from starlette.background import BackgroundTasks

    from myloware.api.routes import webhooks as webhooks_mod
    from myloware.storage.models import ArtifactType, RunStatus

    run_id = uuid.uuid4()
    job_id = "job-1"

    editor_output = SimpleNamespace(
        artifact_type=ArtifactType.EDITOR_OUTPUT.value,
        artifact_metadata={"render_job_id": job_id},
    )

    class FakeArtifactRepo:
        def __init__(self):
            self.created: list[dict[str, object]] = []

        async def get_by_run_async(self, _run_id):  # type: ignore[no-untyped-def]
            return [editor_output]

        async def create_async(self, **kwargs):  # type: ignore[no-untyped-def]
            self.created.append(kwargs)

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

    class FakeRunRepo:
        def __init__(self):
            self.session = FakeSession()

        async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
            return SimpleNamespace(status=RunStatus.AWAITING_RENDER.value)

        async def update_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(webhooks_mod.settings, "disable_background_workflows", False)
    monkeypatch.setattr(webhooks_mod.settings, "workflow_dispatcher", "in_process")
    monkeypatch.setattr(webhooks_mod.settings, "remotion_provider", "real")
    monkeypatch.setattr(webhooks_mod.settings, "remotion_webhook_secret", "secret")

    payload = json.dumps(
        {"status": "done", "output_url": "https://cdn.example/final.mp4", "job_id": job_id}
    ).encode()
    digest = hmac.new(b"secret", payload, hashlib.sha512).hexdigest()

    request = _make_request(
        payload,
        query=f"run_id={run_id}",
        headers={"X-Remotion-Signature": f"sha512={digest}"},
        path="/v1/webhooks/remotion",
    )
    repo = FakeRunRepo()
    artifacts = FakeArtifactRepo()
    resp = await webhooks_mod.remotion_webhook(
        request, BackgroundTasks(), run_repo=repo, artifact_repo=artifacts
    )
    assert resp.status == "accepted"
    assert artifacts.created
