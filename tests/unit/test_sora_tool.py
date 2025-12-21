from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from myloware.config import settings
from myloware.storage.models import ArtifactType
from myloware.tools.sora import SoraGenerationTool


def test_sora_tool_init_validates_provider_and_api_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "off")
    with pytest.raises(ValueError, match="Sora provider is disabled"):
        SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=None)

    monkeypatch.setattr(settings, "sora_provider", "nope")
    with pytest.raises(ValueError, match="Invalid SORA_PROVIDER"):
        SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=None)

    monkeypatch.setattr(settings, "sora_provider", "real")
    monkeypatch.setattr(settings, "openai_api_key", "")
    with pytest.raises(ValueError, match="OpenAI API key required"):
        SoraGenerationTool(run_id=str(uuid4()), api_key=None, use_fake=None)


def test_sora_tool_compute_idempotency_key_requires_run_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=None, api_key="k", use_fake=True)
    assert tool._compute_idempotency_key([], "9:16", "8") == ""


def test_sora_tool_validate_result(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    run_id = str(uuid4())
    tool = SoraGenerationTool(run_id=run_id, api_key="k", use_fake=True)

    with pytest.raises(ValueError, match="task_count must be a positive integer"):
        tool._validate_result({"task_count": 0})

    with pytest.raises(ValueError, match="run_id mismatch"):
        tool._validate_result({"task_count": 1, "run_id": str(uuid4())})

    assert tool._validate_result({"task_count": 1, "run_id": run_id})["task_count"] == 1


@pytest.mark.asyncio
async def test_sora_tool_async_run_impl_routes_to_fake_and_validates_inputs(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    with pytest.raises(ValueError, match="'videos' parameter required"):
        await tool.async_run_impl(videos=None)

    out = await tool.async_run_impl(videos=[{"visual_prompt": "x"}])
    assert out["success"] is True


@pytest.mark.asyncio
async def test_sora_tool_run_fake_lightweight(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    out = await tool._run_fake([{"visual_prompt": "x"}], "9:16", "8")
    assert out["success"] is True
    assert out["fake_mode"] is True
    assert out["task_count"] == 1


@pytest.mark.asyncio
async def test_sora_tool_run_fake_idempotency_hit(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)
    tool.lightweight_fake = False  # force non-lightweight path

    monkeypatch.setattr(tool, "_compute_idempotency_key", lambda *_a, **_kw: "key")

    async def fake_check(_key: str):  # type: ignore[no-untyped-def]
        return {"task_ids": ["t1"], "task_metadata": {"t1": {"video_index": 0}}}

    monkeypatch.setattr(tool, "_check_existing_submission", fake_check)

    out = await tool._run_fake([{"visual_prompt": "x"}], "9:16", "8")
    assert out["success"] is True
    assert out["idempotent"] is True
    assert out["task_ids"] == ["t1"]


@pytest.mark.asyncio
async def test_sora_tool_run_fake_full_path_posts_webhooks(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    run_id = str(uuid4())
    tool = SoraGenerationTool(run_id=run_id, api_key="k", use_fake=True)
    tool.lightweight_fake = False  # force non-lightweight path
    monkeypatch.setattr(tool, "_compute_idempotency_key", lambda *_a, **_kw: "")
    monkeypatch.setattr(tool, "_check_existing_submission", lambda *_a, **_kw: None)

    clip = tmp_path / "video_abc.mp4"
    clip.write_bytes(b"fake")

    monkeypatch.setattr(tool, "_load_fake_clips", lambda _n: [clip])

    stored: list[dict[str, object]] = []

    async def fake_store(task_metadata, *, idempotency_key=None):  # type: ignore[no-untyped-def]
        stored.append({"task_metadata": task_metadata, "idempotency_key": idempotency_key})

    posted: list[tuple[str, int]] = []

    async def fake_post(task_id: str, video_index: int) -> None:
        posted.append((task_id, video_index))

    monkeypatch.setattr(tool, "_store_task_metadata_async", fake_store)
    monkeypatch.setattr(tool, "_post_fake_completion_webhook", fake_post)

    out = await tool._run_fake([{"visual_prompt": "x"}], "9:16", "8")
    assert out["success"] is True
    assert out["task_ids"] == ["video_abc"]
    assert stored
    assert posted == [("video_abc", 0)]


def test_sora_tool_load_fake_clips_from_explicit_paths(monkeypatch, tmp_path: Path) -> None:
    clip1 = tmp_path / "a.mp4"
    clip2 = tmp_path / "b.mp4"
    clip1.write_bytes(b"x")
    clip2.write_bytes(b"y")

    monkeypatch.setattr(settings, "sora_fake_clip_paths", [str(clip1), str(clip2)])
    monkeypatch.setattr(settings, "sora_fake_clips_dir", str(tmp_path / "nope"))

    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    clips = tool._load_fake_clips(2)
    assert clips == [clip1.resolve(), clip2.resolve()]


def test_sora_tool_load_fake_clips_errors(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "sora_fake_clip_paths", [])
    monkeypatch.setattr(settings, "sora_fake_clips_dir", str(tmp_path / "missing"))

    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    with pytest.raises(ValueError, match="no fake clips found"):
        tool._load_fake_clips(1)

    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    (clips_dir / "one.mp4").write_bytes(b"x")
    monkeypatch.setattr(settings, "sora_fake_clips_dir", str(clips_dir))
    with pytest.raises(ValueError, match="Not enough fake Sora clips"):
        tool._load_fake_clips(2)


def test_sora_tool_task_id_from_path() -> None:
    p = Path("/tmp/video_abc.mp4")
    assert SoraGenerationTool._task_id_from_path(p, 0) == "video_abc"

    other = Path("/tmp/foo.mp4")
    assert SoraGenerationTool._task_id_from_path(other, 0).startswith("video_")


@pytest.mark.asyncio
async def test_sora_tool_post_fake_completion_webhook_signs_header(monkeypatch) -> None:
    monkeypatch.setattr(settings, "webhook_base_url", "http://localhost:8000")
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)

    tool = SoraGenerationTool(run_id=str(uuid4()), api_key="k", use_fake=True)

    sent: list[dict[str, object]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return None

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def post(self, url: str, *, content: bytes, headers: dict[str, str]):  # type: ignore[no-untyped-def]
            sent.append({"url": url, "content": content, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr("myloware.tools.sora.httpx.AsyncClient", FakeClient)

    await tool._post_fake_completion_webhook("task", 0)
    assert sent
    assert sent[0]["headers"]["Content-Type"] == "application/json"
    assert str(sent[0]["url"]).endswith("/v1/webhooks/sora")
    assert sent[0]["headers"].get("webhook-id")
    assert sent[0]["headers"].get("webhook-timestamp")
    assert sent[0]["headers"].get("webhook-signature", "").startswith("v1,")

    payload = json.loads(sent[0]["content"])
    assert payload["object"] == "event"
    assert payload["type"] == "video.completed"
    assert payload["data"]["id"] == "task"


@dataclass
class FakeManifest:
    artifact_type: str
    artifact_metadata: dict[str, object]
    content: str


@pytest.mark.asyncio
async def test_sora_tool_check_existing_submission_finds_manifest(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    run_id = str(uuid4())
    tool = SoraGenerationTool(run_id=run_id, api_key="k", use_fake=True)

    manifest = FakeManifest(
        artifact_type=ArtifactType.CLIP_MANIFEST.value,
        artifact_metadata={"idempotency_key": "key"},
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

        async def get_by_run_async(self, _rid: UUID):  # type: ignore[no-untyped-def]
            return [manifest]

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSessionCM())
    )
    monkeypatch.setattr("myloware.tools.sora.ArtifactRepository", FakeRepo)

    out = await tool._check_existing_submission("key")
    assert out and out["from_cache"] is True
    assert out["task_ids"] == ["t1"]


@pytest.mark.asyncio
async def test_sora_tool_check_existing_submission_skips_bad_run_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sora_provider", "fake")
    monkeypatch.setattr(settings, "disable_background_workflows", True)
    tool = SoraGenerationTool(run_id="not-a-uuid", api_key="k", use_fake=True)

    out = await tool._check_existing_submission("key")
    assert out is None
