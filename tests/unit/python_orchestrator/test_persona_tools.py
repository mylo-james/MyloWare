from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from apps.orchestrator import persona_tools


class _MetricsRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def labels(self, **labels):  # type: ignore[no-untyped-def]
        recorder = self

        class _Bound:
            def inc(self, amount: float = 1.0) -> None:  # type: ignore[no-untyped-def]
                recorder.calls.append(dict(labels))

        return _Bound()


class _FakeDB:
    def __init__(self) -> None:
        self.artifacts: list[dict[str, Any]] = []
        self.runs: dict[str, dict[str, Any]] = {}
        self.fail_create_artifact = False
        self.fail_get_run = False
        self.fail_update_run = False
        self.fail_list_artifacts = False

    def create_artifact(
        self,
        *,
        run_id: str,
        artifact_type: str,
        url: str | None,
        provider: str,
        checksum: str | None,
        metadata: dict[str, Any],
        persona: str | None = None,
    ) -> None:
        if self.fail_create_artifact:
            raise RuntimeError("artifact write blocked")
        self.artifacts.append(
            {
                "run_id": run_id,
                "artifact_type": artifact_type,
                "type": artifact_type,
                "url": url,
                "provider": provider,
                "checksum": checksum,
                "metadata": dict(metadata),
                "persona": persona,
            }
        )

    def get_run(self, run_id: str) -> dict[str, Any]:  # pragma: no cover - simple accessor
        if self.fail_get_run:
            raise RuntimeError("get_run failed")
        return self.runs.get(run_id) or {"run_id": run_id}

    def update_run(self, *, run_id: str, status: str, result: dict[str, Any] | None = None) -> None:
        if self.fail_update_run:
            raise RuntimeError("update_run failed")
        record = self.runs.setdefault(run_id, {"run_id": run_id})
        record["status"] = status
        if result is not None:
            record["result"] = dict(result)

    def list_artifacts(self, run_id: str) -> list[dict[str, Any]]:  # pragma: no cover - trivial filter
        if self.fail_list_artifacts:
            raise RuntimeError("list_artifacts failed")
        return [art for art in self.artifacts if art["run_id"] == run_id]


@pytest.fixture()
def fake_db(monkeypatch: pytest.MonkeyPatch) -> _FakeDB:
    fake = _FakeDB()
    monkeypatch.setattr(persona_tools, "_get_db", lambda: fake, raising=False)
    return fake


def test_submit_generation_jobs_tool_calls_kieai(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    fake_db: _FakeDB,
) -> None:
    submitted: list[dict[str, object]] = []

    class FakeKieAI:
        def submit_job(self, **kwargs):  # type: ignore[override]
            submitted.append(kwargs)
            return {"data": {"taskId": f"{kwargs['run_id']}-{kwargs['metadata']['videoIndex']}"}}

    monkeypatch.setattr(persona_tools, "build_kieai_client", lambda settings, cache=None: FakeKieAI())
    metrics = _MetricsRecorder()
    monkeypatch.setattr(persona_tools, "adapter_calls_total", metrics, raising=False)

    videos = json.dumps(
        [
            {"index": 0, "prompt": "Clip A", "duration": 8, "aspectRatio": "9:16", "quality": "720p"},
            {"index": 1, "prompt": "Clip B", "duration": 6, "aspectRatio": "9:16", "quality": "720p"},
        ]
    )

    with caplog.at_level("INFO", logger="myloware.orchestrator.persona_tools"):
        summary = persona_tools.submit_generation_jobs_tool(videos=videos, run_id="run-xyz")

    assert "run-xyz-0" in summary and "run-xyz-1" in summary
    assert len(submitted) == 2
    callback_url = str(submitted[0]["callback_url"])
    # Base path must be the kie.ai webhook endpoint; query params may include run_id
    assert callback_url.startswith(persona_tools.settings.webhook_base_url.rstrip("/") + "/v1/webhooks/kieai")
    assert metrics.calls == [
        {"provider": "kieai", "mode": persona_tools.settings.providers_mode},
        {"provider": "kieai", "mode": persona_tools.settings.providers_mode},
    ]
    provider_records = [record for record in caplog.records if getattr(record, "provider", None) == "kieai"]
    assert provider_records, "expected structured log entry for kieai"
    first_record = provider_records[0]
    assert getattr(first_record, "runId", None) == "run-xyz"
    assert getattr(first_record, "videoIndex", None) == 0
    assert getattr(first_record, "providers_mode", None) == persona_tools.settings.providers_mode
    job_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "kieai.job"]
    assert len(job_artifacts) == 2
    assert job_artifacts[0]["metadata"]["videoIndex"] == 0
    assert job_artifacts[0]["metadata"]["taskId"] == "run-xyz-0"
    assert job_artifacts[0]["persona"] == "riley"


def test_submit_generation_jobs_tool_handles_blank_string(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    class FakeClient:
        def submit_job(self, **kwargs):  # type: ignore[override]
            return {"data": {"taskId": "fallback-0"}}

    monkeypatch.setattr(persona_tools, "build_kieai_client", lambda *_, **__: FakeClient())
    monkeypatch.setattr(persona_tools, "_fetch_run_videos", lambda run_id: [{"index": 0, "prompt": "fallback"}])
    summary = persona_tools.submit_generation_jobs_tool(videos="  ", run_id="run-blank")
    assert "Submitted 1" in summary


def test_submit_generation_jobs_tool_records_error_when_task_id_missing(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    class FakeKieAI:
        def submit_job(self, **kwargs):  # type: ignore[override]
            # Simulate a real kie.ai error payload seen in evidence:
            # {"code": 422, "msg": "Invalid model", "data": null}
            return {"code": 422, "msg": "Invalid model", "data": None}

    monkeypatch.setattr(persona_tools, "build_kieai_client", lambda settings, cache=None: FakeKieAI())

    videos = json.dumps([{"index": 0, "prompt": "Clip A"}])

    with pytest.raises(ValueError) as excinfo:
        persona_tools.submit_generation_jobs_tool(videos=videos, run_id="run-error")

    message = str(excinfo.value)
    assert "no taskId" in message
    assert "422" in message
    assert "Invalid model" in message

    error_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "kieai.error"]
    assert error_artifacts, "Expected kieai.error artifact to be recorded on failure"
    error_meta = error_artifacts[0]["metadata"]
    assert error_meta["errorCode"] == 422
    assert error_meta["errorMessage"] == "Invalid model"
    assert error_meta["videoIndex"] == 0


def test_submit_generation_jobs_tool_does_not_seed_mock_clips(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    monkeypatch.setattr(persona_tools.settings, "providers_mode", "mock", raising=False)

    class FakeKieAI:
        def submit_job(self, **kwargs):  # type: ignore[override]
            return {
                "data": {
                    "taskId": f"{kwargs['run_id']}-{kwargs['metadata']['videoIndex']}",
                }
            }

    monkeypatch.setattr(persona_tools, "build_kieai_client", lambda settings, cache=None: FakeKieAI())
    fake_db.runs["run-mock"] = {
        "run_id": "run-mock",
        "result": {"videos": [{"index": 0, "subject": "Moon", "header": "Clip"}]},
    }
    original_videos = json.loads(json.dumps(fake_db.runs["run-mock"]["result"]["videos"]))
    videos = json.dumps([
        {"index": 0, "subject": "Moon", "header": "Clip", "prompt": "Moon shot"},
        {"index": 1, "subject": "Sun", "header": "Clip", "prompt": "Sun shot"},
    ])

    persona_tools.submit_generation_jobs_tool(videos=videos, run_id="run-mock")

    clip_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "kieai.clip"]
    assert clip_artifacts == [], "mock fallbacks should no longer seed clip artifacts"
    result_videos = fake_db.runs["run-mock"]["result"]["videos"]
    assert result_videos == original_videos, "run videos should remain untouched until providers respond"


def test_wait_for_generations_tool_completes(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    responses = [
        [{"status": "pending"}],
        [{"status": "generated"}],
    ]

    monkeypatch.setattr(persona_tools, "_fetch_run_videos", lambda run_id: responses.pop(0))
    sleeps: list[float] = []
    monkeypatch.setattr(persona_tools, "_sleep", lambda seconds: sleeps.append(seconds))

    message = persona_tools.wait_for_generations_tool("run-abc", expected_count=1, timeout_minutes=0.2)

    assert "ready" in message.lower()
    assert sleeps  # ensures we attempted to poll at least once
    wait_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "kieai.wait"]
    assert wait_artifacts, "wait_for_generations_tool should record a wait artifact"
    wait_meta = wait_artifacts[-1]["metadata"]
    assert wait_meta["status"] == "completed"
    assert wait_meta["generatedCount"] == 1
    assert wait_artifacts[-1]["persona"] == "riley"


def test_wait_for_generations_tool_times_out_and_records_artifact(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    monkeypatch.setattr(persona_tools, "_fetch_run_videos", lambda run_id: [{"status": "pending"}])
    monkeypatch.setattr(persona_tools, "_sleep", lambda seconds: None)

    message = persona_tools.wait_for_generations_tool(
        "run-timeout",
        expected_count=2,
        timeout_minutes=0.01,
        poll_interval_seconds=0.005,
    )

    assert "timeout" in message.lower()
    wait_artifact = [art for art in fake_db.artifacts if art["artifact_type"] == "kieai.wait"][-1]
    assert wait_artifact["metadata"]["status"] == "timeout"
    assert wait_artifact["metadata"]["latestStatus"] == "0/2"


def test_wait_for_generations_tool_validates_intervals() -> None:
    with pytest.raises(ValueError):
        persona_tools.wait_for_generations_tool("run-invalid", expected_count=1, poll_interval_seconds=0)
    with pytest.raises(ValueError):
        persona_tools.wait_for_generations_tool("run-invalid", expected_count=1, timeout_minutes=-1)


def test_render_video_timeline_tool_calls_shotstack(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    fake_db: _FakeDB,
    tmp_path: Path,
) -> None:
    # Build a minimal but valid Shotstack timeline JSON payload
    timeline = {
        "timeline": {
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {"type": "video", "src": "https://cdn.example/video1.mp4"},
                            "start": 0.0,
                            "length": 5.0,
                        },
                        {
                            "asset": {"type": "video", "src": "https://cdn.example/video2.mp4"},
                            "start": 5.0,
                            "length": 5.0,
                        },
                    ]
                }
            ]
        },
        "output": {"format": "mp4", "resolution": "1080x1920", "fps": 30},
    }

    captured: dict[str, object] = {}

    class FakeShotstack:
        def render(self, timeline):  # type: ignore[override]
            captured["timeline"] = timeline
            return {"url": "https://mock.video/output.mp4", "status": "done", "id": "job-123"}

    monkeypatch.setattr(persona_tools, "build_shotstack_client", lambda settings, cache=None: FakeShotstack())
    metrics = _MetricsRecorder()
    monkeypatch.setattr(persona_tools, "adapter_calls_total", metrics, raising=False)
    with caplog.at_level("INFO", logger="myloware.orchestrator.persona_tools"):
        summary = persona_tools.render_video_timeline_tool("run-render", timeline)

    assert "output.mp4" in summary
    normalized = captured["timeline"]["output"]
    assert normalized["resolution"] == "1080"
    assert normalized["aspectRatio"] == "9:16"
    assert metrics.calls == [{"provider": "shotstack", "mode": persona_tools.settings.providers_mode}]
    render_records = [record for record in caplog.records if getattr(record, "provider", None) == "shotstack"]
    assert render_records, "expected structured log entry for shotstack render"
    assert getattr(render_records[0], "runId", None) == "run-render"
    artifact_types = [art["artifact_type"] for art in fake_db.artifacts]
    assert "shotstack.timeline" in artifact_types
    assert "render.url" in artifact_types
    timeline_artifact = next(art for art in fake_db.artifacts if art["artifact_type"] == "shotstack.timeline")
    assert timeline_artifact["persona"] == "alex"
    normalized_output = timeline_artifact["metadata"]["timeline"]["output"]
    assert normalized_output["resolution"] == "1080"
    assert normalized_output["aspectRatio"] == "9:16"
    render_artifact = next(art for art in fake_db.artifacts if art["artifact_type"] == "render.url")
    assert render_artifact["persona"] == "alex"
    run_record = fake_db.runs["run-render"]
    assert run_record["result"]["renderUrl"] == "https://mock.video/output.mp4"
    assert run_record["result"]["videos"][0]["renderUrl"] == "https://mock.video/output.mp4"


def test_render_video_timeline_tool_auto_builds_from_run_videos(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    run_id = "run-auto"
    fake_db.runs[run_id] = {
        "run_id": run_id,
        "status": "generating",
        "result": {
            "videos": [
                {
                    "index": 0,
                    "status": "generated",
                    "assetUrl": "https://cdn.example/a.mp4",
                    "header": "Alpha",
                    "subject": "Moon Burger",
                },
                {
                    "index": 1,
                    "status": "generated",
                    "assetUrl": "https://cdn.example/b.mp4",
                    "header": "Beta",
                    "subject": "Sun Pickle",
                },
            ]
        },
    }
    captured: dict[str, Any] = {}

    class FakeShotstack:
        def render(self, timeline):  # type: ignore[override]
            captured["timeline"] = timeline
            return {"url": "https://mock.video/auto.mp4", "status": "done", "id": "job-auto"}

    monkeypatch.setattr(persona_tools, "build_shotstack_client", lambda settings, cache=None: FakeShotstack())
    metrics = _MetricsRecorder()
    monkeypatch.setattr(persona_tools, "adapter_calls_total", metrics, raising=False)

    summary = persona_tools.render_video_timeline_tool(run_id)

    assert "auto.mp4" in summary
    timeline = captured["timeline"]
    tracks = timeline["timeline"]["tracks"]
    # Auto-build now follows the rich template:
    # - One primary text track per clip.
    # - One secondary text track per clip.
    # - One video track per clip.
    assert len(tracks) == 6
    # Primary text overlays (upper block).
    text_track_0 = tracks[0]
    text_track_1 = tracks[1]
    assert text_track_0["clips"][0]["asset"]["type"] == "text"
    assert text_track_0["clips"][0]["asset"]["text"] == "Alpha"
    assert text_track_1["clips"][0]["asset"]["text"] == "Beta"
    # Secondary text overlays (subjects).
    secondary_track_0 = tracks[2]
    secondary_track_1 = tracks[3]
    assert secondary_track_0["clips"][0]["asset"]["text"] == "Moon Burger"
    assert secondary_track_1["clips"][0]["asset"]["text"] == "Sun Pickle"
    # Last two tracks are video clips with matching asset URLs.
    video_track_0 = tracks[4]
    video_track_1 = tracks[5]
    clip0 = video_track_0["clips"][0]
    clip1 = video_track_1["clips"][0]
    assert clip0["asset"]["src"] == "https://cdn.example/a.mp4"
    assert clip1["asset"]["src"] == "https://cdn.example/b.mp4"
    # Video clips should start slightly before their corresponding text (0.5s lead).
    assert clip0["start"] == pytest.approx(text_track_0["clips"][0]["start"] - 0.5)
    assert clip1["start"] == pytest.approx(text_track_1["clips"][0]["start"] - 0.5)
    # Output block should be normalized to HD 9:16.
    output = timeline["output"]
    assert output["resolution"] == "hd"
    assert output["aspectRatio"] == "9:16"
    assert metrics.calls == [{"provider": "shotstack", "mode": persona_tools.settings.providers_mode}]
    render_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "render.url"]
    assert render_artifacts and render_artifacts[-1]["url"] == "https://mock.video/auto.mp4"
    timeline_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "shotstack.timeline"]
    assert timeline_artifacts, "auto-build should still persist timeline metadata"
    updated_run = fake_db.runs[run_id]
    video_entries = updated_run["result"]["videos"]
    assert all(video.get("renderUrl") == "https://mock.video/auto.mp4" for video in video_entries)
    assert updated_run["result"]["renderUrl"] == "https://mock.video/auto.mp4"


def test_record_artifact_handles_db_error(monkeypatch: pytest.MonkeyPatch) -> None:
    broken = _FakeDB()
    broken.fail_create_artifact = True
    monkeypatch.setattr(persona_tools, "_get_db", lambda: broken, raising=False)

    persona_tools._record_artifact(
        "run-log",
        artifact_type="test",
        provider="unit",
        url="https://example",
        metadata={"foo": "bar"},
        persona="alex",
    )

    assert broken.artifacts == [], "artifacts should be skipped when DB write fails"


def test_update_run_render_record_updates_result(fake_db: _FakeDB) -> None:
    run_id = "run-final"
    fake_db.runs[run_id] = {
        "run_id": run_id,
        "status": "generating",
        "result": {"videos": [{"index": 0, "status": "pending"}]},
    }

    persona_tools._update_run_render_record(run_id, "https://render/final.mp4", provider_job_id="job-77")

    record = fake_db.runs[run_id]
    assert record["result"]["renderUrl"] == "https://render/final.mp4"
    assert record["result"]["finalRenderUrl"] == "https://render/final.mp4"
    assert record["result"]["videos"][0]["renderUrl"] == "https://render/final.mp4"
    assert record["result"]["renders"][-1]["jobId"] == "job-77"


def test_update_run_render_record_swallows_update_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    broken = _FakeDB()
    run_id = "run-broken"
    broken.runs[run_id] = {"run_id": run_id, "status": "generating", "result": {"videos": []}}
    broken.fail_update_run = True
    monkeypatch.setattr(persona_tools, "_get_db", lambda: broken, raising=False)

    before = json.loads(json.dumps(broken.runs[run_id]["result"]))
    persona_tools._update_run_render_record(run_id, "https://render/skip.mp4")

    assert broken.runs[run_id]["result"] == before


def test_resolve_final_render_url_prefers_artifacts(fake_db: _FakeDB) -> None:
    run_id = "run-pref"
    fake_db.runs[run_id] = {
        "run_id": run_id,
        "result": {
            "renderUrl": "https://stale/render.mp4",
            "videos": [{"index": 0, "renderUrl": "https://video/render.mp4"}],
        },
    }
    fake_db.artifacts.append({"run_id": run_id, "type": "render.url", "url": "https://artifact/render.mp4"})

    url = persona_tools._resolve_final_render_url_for_run(run_id)

    assert url == "https://artifact/render.mp4"


def test_resolve_final_render_url_handles_db_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(persona_tools, "_get_db", boom, raising=False)

    assert persona_tools._resolve_final_render_url_for_run("missing") is None


def test_render_video_timeline_tool_records_error_artifact_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    """Shotstack failures should emit a shotstack.error artifact instead of being silent."""
    run_id = "run-shotstack-fail"
    fake_db.runs[run_id] = {"run_id": run_id, "status": "generating", "result": {"videos": []}}

    class FailingShotstack:
        def render(self, timeline):  # type: ignore[override]
            raise RuntimeError("shotstack boom")

    monkeypatch.setattr(persona_tools, "build_shotstack_client", lambda settings, cache=None: FailingShotstack())

    # Minimal valid timeline payload so we reach the client.render call.
    timeline = {
        "timeline": {
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {"type": "video", "src": "https://cdn.example/clip.mp4"},
                            "start": 0.0,
                            "length": 5.0,
                        }
                    ]
                }
            ]
        },
        "output": {"format": "mp4", "resolution": "1080x1920", "fps": 30},
    }

    with pytest.raises(RuntimeError):
        persona_tools.render_video_timeline_tool(run_id, timeline)

    error_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "shotstack.error"]
    assert error_artifacts, "expected shotstack.error artifact when ShotstackClient.render fails"
    metadata = error_artifacts[-1]["metadata"]
    assert metadata["persona"] == "alex"
    assert "shotstack boom" in metadata["error"]

def test_publish_to_tiktok_tool_uses_upload_post(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    fake_db: _FakeDB,
) -> None:
    monkeypatch.setattr(persona_tools.settings, "providers_mode", "live", raising=False)
    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"binary data")

    class FakeUpload:
        def publish(self, **kwargs):  # type: ignore[override]
            assert kwargs["video_path"] == video_path
            assert kwargs["caption"] == "Test caption"
            return {"canonicalUrl": "https://publish.mock/run/video", "status": "ok"}

    monkeypatch.setattr(persona_tools, "build_upload_post_client", lambda settings, cache=None: FakeUpload())
    metrics = _MetricsRecorder()
    monkeypatch.setattr(persona_tools, "adapter_calls_total", metrics, raising=False)

    # Seed run record with a resolved render URL so the tool can look it up.
    fake_db.runs["run-pub"] = {
        "run_id": "run-pub",
        "status": "generating",
        "result": {"videos": [{"index": 0, "renderUrl": str(video_path)}], "renderUrl": str(video_path)},
    }

    with caplog.at_level("INFO", logger="myloware.orchestrator.persona_tools"):
        summary = persona_tools.publish_to_tiktok_tool(caption="Test caption", run_id="run-pub")

    assert "https://publish.mock/run/video" in summary
    assert metrics.calls == [{"provider": "upload-post", "mode": persona_tools.settings.providers_mode}]
    publish_records = [record for record in caplog.records if getattr(record, "provider", None) == "upload-post"]
    assert publish_records, "expected structured log entry for upload-post"
    assert getattr(publish_records[0], "runId", None) == "run-pub"
    publish_artifacts = [art for art in fake_db.artifacts if art["artifact_type"] == "publish.url"]
    assert len(publish_artifacts) == 1
    assert publish_artifacts[0]["url"] == "https://publish.mock/run/video"
    assert publish_artifacts[0]["persona"] == "quinn"
    # Live mode records the source URL Quinn actually published.
    assert publish_artifacts[0]["metadata"]["source"] == str(video_path)


def test_publish_to_tiktok_tool_handles_missing_canonical_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    fake_db: _FakeDB,
) -> None:
    monkeypatch.setattr(persona_tools.settings, "providers_mode", "live", raising=False)
    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"binary data")

    class FakeUploadMissingUrl:
        def publish(self, **kwargs):  # type: ignore[override]
            return {
                "success": True,
                "results": {
                    "tiktok": {
                        "publish_id": "12345",
                        "status": "ok",
                    }
                },
            }

    monkeypatch.setattr(persona_tools, "build_upload_post_client", lambda settings, cache=None: FakeUploadMissingUrl())

    fake_db.runs["run-missing-url"] = {
        "run_id": "run-missing-url",
        "status": "generating",
        "result": {"videos": [{"index": 0, "renderUrl": str(video_path)}], "renderUrl": str(video_path)},
    }

    summary = persona_tools.publish_to_tiktok_tool(caption="Fallback caption", run_id="run-missing-url")

    assert "upload-post://run-missing-url/12345" in summary
    publish_artifact = next(art for art in fake_db.artifacts if art["artifact_type"] == "publish.url")
    assert publish_artifact["metadata"]["success"] is True
    assert publish_artifact["url"] == "upload-post://run-missing-url/12345"


def test_publish_to_tiktok_tool_mock_mode(monkeypatch: pytest.MonkeyPatch, fake_db: _FakeDB) -> None:
    monkeypatch.setattr(persona_tools.settings, "providers_mode", "mock", raising=False)
    metrics = _MetricsRecorder()
    monkeypatch.setattr(persona_tools, "adapter_calls_total", metrics, raising=False)

    def _fail(*_args, **_kwargs):  # noqa: ANN001
        raise AssertionError("mock mode should not fetch video files")

    monkeypatch.setattr(persona_tools, "_ensure_local_video_file", _fail, raising=False)

    fake_db.runs["run-mock-pub"] = {
        "run_id": "run-mock-pub",
        "status": "generating",
        "result": {
            "videos": [{"index": 0, "renderUrl": "https://mock.video/render.mp4"}],
            "renderUrl": "https://mock.video/render.mp4",
        },
    }

    summary = persona_tools.publish_to_tiktok_tool(
        caption="Mock caption",
        run_id="run-mock-pub",
    )

    assert "Mock-published run run-mock-pub" in summary
    publish_artifact = next(art for art in fake_db.artifacts if art["artifact_type"] == "publish.url")
    assert publish_artifact["metadata"]["mock"] is True
    assert publish_artifact["metadata"]["caption"] == "Mock caption"
    run_record = fake_db.runs["run-mock-pub"]
    assert run_record["status"] == "published"
    assert publish_artifact["url"] in run_record["result"]["publishUrls"]
    assert metrics.calls == [{"provider": "upload-post", "mode": "mock"}]


def test_publish_to_tiktok_tool_prefers_render_artifact_url(monkeypatch: pytest.MonkeyPatch, fake_db: _FakeDB) -> None:
    """Quinn should prefer Alex's stitched render over a raw asset URL."""

    monkeypatch.setattr(persona_tools.settings, "providers_mode", "mock", raising=False)
    metrics = _MetricsRecorder()
    monkeypatch.setattr(persona_tools, "adapter_calls_total", metrics, raising=False)

    run_id = "run-render-pref"
    # Seed a render.url artifact for this run.
    fake_db.create_artifact(
        run_id=run_id,
        artifact_type="render.url",
        url="https://final.render.myloware/run.mp4",
        provider="shotstack",
        checksum=None,
        metadata={"persona": "alex"},
        persona="alex",
    )

    # Even if the run record only contains raw assetUrls, the tool should resolve
    # the final render URL from artifacts.
    fake_db.runs[run_id] = {
        "run_id": run_id,
        "status": "generating",
        "result": {
            "videos": [
                {"index": 0, "status": "generated", "assetUrl": "https://assets.mock/raw-sun-clip.mp4"},
            ]
        },
    }

    summary = persona_tools.publish_to_tiktok_tool(
        caption="Override test",
        run_id=run_id,
    )

    assert "Mock-published run run-render-pref" in summary
    publish_artifact = next(art for art in fake_db.artifacts if art["artifact_type"] == "publish.url")
    meta = publish_artifact["metadata"]
    # Source should be the final render URL resolved from artifacts.
    assert meta["source"] == "https://final.render.myloware/run.mp4"


def test_resolve_social_account_defaults_to_aismr(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeSocialDB(_FakeDB):
        def get_primary_social_for_project(self, project):  # type: ignore[override]
            return None

    fake = _FakeSocialDB()
    fake.runs["run-soc"] = {"run_id": "run-soc", "project": "test_video_gen"}
    monkeypatch.setattr(persona_tools, "_get_db", lambda: fake, raising=False)

    account_id, provider = persona_tools._resolve_social_account_for_run("run-soc")

    assert account_id == "AISMR"
    assert provider == "upload-post"


def test_render_video_timeline_tool_requires_video_clips_for_generated_videos(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: _FakeDB,
) -> None:
    """Alex's timeline must include a video clip for each generated video."""
    run_id = "run-missing-video"
    # Seed DB with two generated videos that both have assetUrl values.
    fake_db.runs[run_id] = {
        "run_id": run_id,
        "status": "generating",
        "result": {
            "videos": [
                {
                    "index": 0,
                    "status": "generated",
                    "assetUrl": "https://example.com/clip-0.mp4",
                },
                {
                    "index": 1,
                    "status": "generated",
                    "assetUrl": "https://example.com/clip-1.mp4",
                },
            ]
        },
    }

    # Timeline only contains a single video clip; the second generated video is missing.
    timeline = {
        "timeline": {
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {"type": "video", "src": "https://example.com/clip-0.mp4"},
                            "start": 0,
                            "length": 8,
                        }
                    ]
                },
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "title",
                                "text": "Header One",
                                "style": "minimal",
                                "size": "small",
                                "color": "#FFFFFF",
                                "background": "#000000AA",
                            },
                            "start": 0,
                            "length": 8,
                        }
                    ]
                },
            ]
        },
        "output": {"format": "mp4", "resolution": "1080"},
    }

    # Ensure we fail-fast before calling the real Shotstack client.
    def _fail_build_client(*_args, **_kwargs):  # noqa: ANN001
        raise AssertionError("Shotstack client should not be called when timeline is invalid")

    monkeypatch.setattr(persona_tools, "build_shotstack_client", _fail_build_client, raising=False)

    with pytest.raises(ValueError, match="includes only 1 video clips for 2 generated videos"):
        persona_tools.render_video_timeline_tool(run_id, timeline)
