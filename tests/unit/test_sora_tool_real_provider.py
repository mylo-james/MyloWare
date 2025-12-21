"""Additional tests for SoraGenerationTool real-provider path and metadata storage."""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from myloware.config import settings
from myloware.tools.sora import SoraGenerationTool


def test_sora_init_real_provider_warns_when_callback_url_missing(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "webhook_base_url", "")

    # Should not raise (callback_url is optional), but should execute warning path.
    SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=None)


def test_sora_init_use_fake_providers_overrides_real(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key=None, use_fake=None)
    assert tool.provider_mode == "fake"


def test_sora_schema_and_metadata_helpers(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    assert tool.get_name() == "sora_generate"
    assert "Sora 2" in tool.get_description()
    schema = tool.get_input_schema()
    assert schema["type"] == "object"
    assert "videos" in schema["properties"]


def test_sora_compute_idempotency_key_is_stable(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    videos_a = [{"visual_prompt": "x", "topic": "t"}]
    videos_b = [{"topic": "t", "visual_prompt": "x"}]
    assert tool._compute_idempotency_key(videos_a, "9:16", 8) == tool._compute_idempotency_key(
        videos_b, "9:16", 8
    )


def test_sora_compute_idempotency_key_is_order_sensitive(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    videos_a = [{"visual_prompt": "a"}, {"visual_prompt": "b"}]
    videos_b = [{"visual_prompt": "b"}, {"visual_prompt": "a"}]
    assert tool._compute_idempotency_key(videos_a, "9:16", 8) != tool._compute_idempotency_key(
        videos_b, "9:16", 8
    )


def test_store_task_metadata_sync_persists_manifest(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    run_id = str(uuid4())
    tool = SoraGenerationTool(run_id=run_id, api_key="k", use_fake=True)

    created: list[dict[str, object]] = []

    class FakeRepo:
        def __init__(self, session):  # type: ignore[no-untyped-def]
            return None

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            created.append(kwargs)

    class FakeSession:
        def commit(self) -> None:
            return None

    class FakeSessionCM:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr("myloware.tools.sora.get_session", lambda: FakeSessionCM())
    monkeypatch.setattr("myloware.tools.sora.ArtifactRepository", FakeRepo)

    tool._store_task_metadata_sync({"t1": {"video_index": 0}}, idempotency_key="key")
    assert created and created[0]["run_id"]  # type: ignore[index]


def test_store_task_metadata_sync_noops_without_run_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=None, api_key="k", use_fake=True)

    def boom():  # type: ignore[no-untyped-def]
        raise AssertionError("get_session should not be called")

    monkeypatch.setattr("myloware.tools.sora.get_session", boom)
    tool._store_task_metadata_sync({"t1": {"video_index": 0}})


@pytest.mark.anyio
async def test_store_task_metadata_async_commits(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    committed: list[bool] = []
    created: list[dict[str, object]] = []

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def commit(self) -> None:
            committed.append(True)

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def create_async(self, **kwargs):  # type: ignore[no-untyped-def]
            created.append(kwargs)

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSessionCM())
    )
    monkeypatch.setattr("myloware.tools.sora.ArtifactRepository", FakeRepo)

    await tool._store_task_metadata_async({"t1": {"video_index": 0}}, idempotency_key="key")
    assert created
    assert committed == [True]


@pytest.mark.anyio
async def test_store_task_metadata_async_noops_without_run_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=None, api_key="k", use_fake=True)

    def boom():  # type: ignore[no-untyped-def]
        raise AssertionError("get_async_session_factory should not be called")

    monkeypatch.setattr("myloware.storage.database.get_async_session_factory", boom)
    await tool._store_task_metadata_async({"t1": {"video_index": 0}}, idempotency_key="key")


@pytest.mark.anyio
async def test_check_existing_submission_handles_parse_failure(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    run_id = str(uuid4())
    tool = SoraGenerationTool(run_id=run_id, api_key="k", use_fake=True)

    manifest = SimpleNamespace(
        artifact_type="clip_manifest",
        artifact_metadata={"idempotency_key": "key"},
        content="{not-json}",
    )

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_by_run_async(self, _rid):  # type: ignore[no-untyped-def]
            return [manifest]

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSessionCM())
    )
    monkeypatch.setattr("myloware.tools.sora.ArtifactRepository", FakeRepo)

    assert await tool._check_existing_submission("key") is None


@pytest.mark.anyio
async def test_check_existing_submission_returns_none_without_run_id_or_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=None, api_key="k", use_fake=True)
    assert await tool._check_existing_submission("key") is None


@pytest.mark.anyio
async def test_check_existing_submission_returns_none_when_no_match(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    manifest = SimpleNamespace(
        artifact_type="clip_manifest",
        artifact_metadata={"idempotency_key": "different"},
        content=json.dumps({"t1": {"video_index": 0}}),
    )

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_by_run_async(self, _rid):  # type: ignore[no-untyped-def]
            return [manifest]

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSessionCM())
    )
    monkeypatch.setattr("myloware.tools.sora.ArtifactRepository", FakeRepo)

    assert await tool._check_existing_submission("key") is None


@pytest.mark.anyio
async def test_run_real_idempotency_hit_returns_cached_task_ids(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=None)
    monkeypatch.setattr(tool, "_compute_idempotency_key", lambda *_a, **_k: "key")

    async def existing(_key: str):  # type: ignore[no-untyped-def]
        return {"task_ids": ["t1"], "task_metadata": {"t1": {"video_index": 0}}}

    monkeypatch.setattr(tool, "_check_existing_submission", existing)

    out = await tool._run_real(
        videos=[{"visual_prompt": "x"}], aspect_ratio="9:16", n_frames=8, remove_watermark=True
    )
    assert out["success"] is True
    assert out["idempotent"] is True
    assert out["task_ids"] == ["t1"]


@pytest.mark.anyio
async def test_async_run_impl_routes_to_real_provider(monkeypatch) -> None:
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=False)

    called: dict[str, object] = {}

    async def fake_run_real(**kwargs):  # type: ignore[no-untyped-def]
        called["kwargs"] = kwargs
        return {"success": True, "task_count": 1}

    monkeypatch.setattr(tool, "_run_real", fake_run_real)

    out = await tool.async_run_impl(videos=[{"visual_prompt": "x"}])
    assert out["success"] is True
    assert called["kwargs"]["videos"] == [{"visual_prompt": "x"}]  # type: ignore[index]


@pytest.mark.anyio
async def test_run_real_fail_fast_stops_on_error_and_persists_manifest(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "webhook_base_url", "http://localhost:8000")

    run_id = str(uuid4())
    tool = SoraGenerationTool(run_id=run_id, api_key="k", use_fake=None)
    monkeypatch.setattr(tool, "_compute_idempotency_key", lambda *_a, **_k: "")

    stored: list[dict[str, object]] = []

    async def fake_store(task_metadata, *, idempotency_key=None):  # type: ignore[no-untyped-def]
        stored.append({"task_metadata": task_metadata, "idempotency_key": idempotency_key})

    monkeypatch.setattr(tool, "_store_task_metadata_async", fake_store)

    calls: list[dict[str, object]] = []

    class FakeResponse:
        def __init__(self, *, status_code: int, payload: dict[str, object], text: str = ""):
            self.status_code = status_code
            self._payload = payload
            self.text = text

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                req = httpx.Request("POST", "https://api.openai.com/v1/videos")
                resp = httpx.Response(self.status_code, request=req)
                raise httpx.HTTPStatusError("bad", request=req, response=resp)

        def json(self):  # type: ignore[no-untyped-def]
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            self._i = 0

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def post(self, url: str, *, json, headers):  # type: ignore[no-untyped-def]
            calls.append({"url": url, "json": dict(json), "headers": dict(headers)})
            if self._i == 0:
                self._i += 1
                return FakeResponse(status_code=200, payload={"id": "t1"})
            # Second video: fail hard to ensure fail-fast stops further submissions.
            raise RuntimeError("boom")

    monkeypatch.setattr("myloware.tools.sora.httpx.AsyncClient", FakeClient)

    with pytest.raises(ValueError, match=r"Sora submission failed after 1/3 tasks"):
        await tool._run_real(
            videos=[
                {"visual_prompt": "x", "voice_over": "hi", "topic": "t"},
                {"visual_prompt": "y"},
                {"visual_prompt": "z"},
            ],
            aspect_ratio="landscape",
            n_frames="999",
            remove_watermark=True,
        )

    assert stored
    assert list((stored[0]["task_metadata"] or {}).keys()) == ["t1"]

    assert calls[0]["headers"]["Authorization"].startswith("Bearer ")
    assert len(calls) == 2  # fail-fast: stops after the first error


@pytest.mark.anyio
async def test_run_real_raises_when_no_tasks_submitted(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=None)
    monkeypatch.setattr(tool, "_compute_idempotency_key", lambda *_a, **_k: "")

    class FakeResponse:
        status_code = 200
        text = ""

        def raise_for_status(self) -> None:
            return None

        def json(self):  # type: ignore[no-untyped-def]
            return {"missing": "id"}

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return None

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def post(self, _url: str, *, json, headers):  # type: ignore[no-untyped-def]
            assert "Authorization" in headers
            assert "prompt" in json
            return FakeResponse()

    monkeypatch.setattr("myloware.tools.sora.httpx.AsyncClient", FakeClient)

    with pytest.raises(ValueError, match=r"Sora submission failed after 0/1 tasks"):
        await tool._run_real(
            videos=[{"visual_prompt": "x"}],
            aspect_ratio="9:16",
            n_frames=8,
            remove_watermark=True,
        )


@pytest.mark.anyio
async def test_submit_openai_videos_respects_explicit_video_index(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=None)

    class FakeResponse:
        status_code = 200
        text = ""

        def raise_for_status(self) -> None:
            return None

        def json(self):  # type: ignore[no-untyped-def]
            return {"id": "t1"}

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return None

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def post(self, _url: str, *, json, headers):  # type: ignore[no-untyped-def]
            assert "Authorization" in headers
            assert json.get("seconds") in {"4", "8", "12"}
            return FakeResponse()

    monkeypatch.setattr("myloware.tools.sora.httpx.AsyncClient", FakeClient)

    task_ids, task_metadata, stop_error = await tool._submit_openai_videos(
        videos=[{"visual_prompt": "x", "video_index": 7}],
        aspect_ratio="9:16",
        n_frames=8,
    )
    assert stop_error is None
    assert task_ids == ["t1"]
    assert task_metadata["t1"]["video_index"] == 7


@pytest.mark.anyio
async def test_submit_openai_videos_appends_aismr_constraints_when_run_is_aismr(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "use_fake_providers", False)
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=None)

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        text = ""

        def raise_for_status(self) -> None:
            return None

        def json(self):  # type: ignore[no-untyped-def]
            return {"id": "t1"}

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return None

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def post(self, _url: str, *, json, headers):  # type: ignore[no-untyped-def]
            assert "Authorization" in headers
            captured["prompt"] = json.get("prompt")
            return FakeResponse()

    monkeypatch.setattr("myloware.tools.sora.httpx.AsyncClient", FakeClient)

    task_ids, _task_metadata, stop_error = await tool._submit_openai_videos(
        videos=[{"visual_prompt": "x", "voice_over": "hi"}],
        aspect_ratio="9:16",
        n_frames=8,
        workflow_name="aismr",
    )
    assert stop_error is None
    assert task_ids == ["t1"]
    prompt = str(captured.get("prompt") or "")
    assert "GLOBAL CONSTRAINTS (AISMR)" in prompt
    assert "NO BACKGROUND MUSIC" in prompt


@pytest.mark.anyio
async def test_async_run_impl_rejects_unknown_provider_mode(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)
    tool.provider_mode = "nope"

    with pytest.raises(ValueError, match="Unsupported Sora provider mode"):
        await tool.async_run_impl(videos=[{"visual_prompt": "x"}])


@pytest.mark.anyio
async def test_run_fake_sets_default_seconds_token_and_includes_topic(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", False)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)
    tool.lightweight_fake = False
    monkeypatch.setattr(tool, "_compute_idempotency_key", lambda *_a, **_k: "")

    clip = tmp_path / "video_abc.mp4"
    clip.write_bytes(b"x")
    monkeypatch.setattr(tool, "_load_fake_clips", lambda _n: [clip])

    async def _noop(*_a, **_k):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(tool, "_post_fake_completion_webhook", _noop)
    monkeypatch.setattr(tool, "_store_task_metadata_async", _noop)

    out = await tool._run_fake([{"visual_prompt": "x", "topic": "t"}], "9:16", "999")
    assert out["success"] is True
    assert out["n_frames"] == "8"
