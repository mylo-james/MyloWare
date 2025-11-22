from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

from apps.api.config import Settings
from apps.api.services.test_video_gen import VideoGenService
from core.runs.schema import build_graph_spec, build_run_payload


class FakeDB:
    def __init__(self) -> None:
        self.artifacts: list[dict] = []
        self.runs: dict[str, dict] = {}
        self.webhooks: set[str] = set()
        self.dlq_events: list[dict] = []

    def create_run(self, *, run_id: str, project: str, status: str, payload):  # type: ignore[no-untyped-def]
        self.runs[run_id] = {"run_id": run_id, "project": project, "status": status, "payload": payload}

    def create_artifact(self, **kwargs):  # type: ignore[no-untyped-def]
        if "artifact_type" in kwargs:
            kwargs.setdefault("type", kwargs["artifact_type"])
        kwargs.setdefault("id", uuid4())
        kwargs.setdefault("created_at", datetime.now(UTC))
        self.artifacts.append(kwargs)

    def update_run(self, *, run_id: str, status: str, result=None):  # type: ignore[no-untyped-def]
        self.runs[run_id]["status"] = status
        self.runs[run_id]["result"] = result

    def get_run(self, run_id: str):  # type: ignore[no-untyped-def]
        return self.runs.get(run_id)

    def record_webhook_event(self, *, idempotency_key: str, **kwargs):  # type: ignore[no-untyped-def]
        if idempotency_key in self.webhooks:
            return False
        self.webhooks.add(idempotency_key)
        return True

    def record_webhook_dlq(self, *, idempotency_key: str, provider: str, headers, payload, error: str, retry_count: int = 0, next_retry_at=None):  # type: ignore[no-untyped-def]
        self.dlq_events.append(
            {
                "idempotency_key": idempotency_key,
                "provider": provider,
                "headers": headers,
                "payload": payload,
                "error": error,
                "retry_count": retry_count,
                "next_retry_at": next_retry_at,
            }
        )


class FakeKieAI:
    def __init__(self) -> None:
        self.secret = b"secret"
        self.calls: list[dict] = []

    def submit_job(  # type: ignore[no-untyped-def]
        self,
        *,
        prompt: str,
        run_id: str,
        callback_url: str,
        duration: int,
        aspect_ratio: str,
        quality: str,
        model: str,
        metadata=None,
    ):
        call = {
            "prompt": prompt,
            "run_id": run_id,
            "callback_url": callback_url,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "quality": quality,
            "model": model,
            "metadata": metadata or {},
        }
        self.calls.append(call)
        index = metadata.get("videoIndex") if metadata else len(self.calls) - 1
        return {"code": 200, "data": {"taskId": f"job-{index}", "runId": run_id, "metadata": metadata}}

    def verify_signature(self, payload: bytes, signature: str | None) -> bool:
        expected = "deadbeef"
        return signature == expected


class FakeUploadPost:
    def __init__(self, response: dict | None = None) -> None:
        self.response = {"canonicalUrl": "https://tiktok.example/video"} if response is None else response
        self.publish_calls: list[dict] = []

    def publish(self, *, video_path: Path, caption: str, account_id: str | None = None, **_: object):  # type: ignore[no-untyped-def]
        call = {"video_path": video_path, "caption": caption, "account_id": account_id}
        self.publish_calls.append(call)
        payload = {"caption": caption, "accountId": account_id}
        payload.update(self.response)
        return payload

    def verify_signature(self, payload: bytes, signature: str | None) -> bool:
        return bool(signature)


class FakeOrchestrator:
    def __init__(self) -> None:
        self.invocations: list[tuple[str, dict, dict[str, object]]] = []

    def invoke(self, run_id: str, payload, **kwargs):  # type: ignore[no-untyped-def]
        self.invocations.append((run_id, payload, kwargs))
        return {"run_id": run_id, "state": payload}


class FailingOrchestratorHTTP:
    """Fails with HTTPStatusError to simulate orchestrator rejecting a request."""

    def invoke(self, run_id: str, payload, **kwargs):  # type: ignore[no-untyped-def]
        import httpx

        request = httpx.Request("POST", f"http://orchestrator/runs/{run_id}")
        response = httpx.Response(502, request=request, text="upstream unavailable")
        raise httpx.HTTPStatusError("bad gateway", request=request, response=response)


class FailingOrchestratorConnect:
    """Fails with ConnectError to simulate orchestrator being unreachable."""

    def invoke(self, run_id: str, payload, **kwargs):  # type: ignore[no-untyped-def]
        import httpx

        request = httpx.Request("POST", f"http://orchestrator/runs/{run_id}")
        raise httpx.ConnectError("connection refused", request=request)


class _WebhookMetricRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def labels(self, **labels):  # type: ignore[no-untyped-def]
        recorder = self

        class _Bound:
            def inc(self, amount: float = 1.0) -> None:  # type: ignore[no-untyped-def]
                recorder.calls.append(dict(labels))

        return _Bound()


def _build_service(
    *,
    settings: Settings | None = None,
    orchestrator: FakeOrchestrator | None = None,
    db: FakeDB | None = None,
    kieai: FakeKieAI | None = None,
    upload_post: FakeUploadPost | None = None,
) -> VideoGenService:
    """Helper to construct VideoGenService for tests."""
    base_settings = settings or Settings(rag_persona_prompts=False)
    db = db or FakeDB()
    orchestrator = orchestrator or FakeOrchestrator()
    return VideoGenService(
        db=db,
        kieai=kieai or FakeKieAI(),
        upload_post=upload_post or FakeUploadPost(),
        orchestrator=orchestrator,
        webhook_base_url="http://localhost:8080",
        settings=base_settings,
    )


@pytest.fixture()
def service() -> VideoGenService:
    return _build_service()


@pytest.fixture()
def webhook_metrics(monkeypatch: pytest.MonkeyPatch) -> _WebhookMetricRecorder:
    from apps.api.services.test_video_gen import webhook_handlers

    recorder = _WebhookMetricRecorder()
    monkeypatch.setattr(webhook_handlers, "webhook_verify_total", recorder, raising=False)
    return recorder


def _seed_run(service: VideoGenService, run_id: str, *, videos: list[dict] | None = None) -> None:
    payload = {
        "project_spec": {"specs": {"videoCount": len(videos or []) or 1}},
    }
    result = {
        "videos": videos or [{"index": 0, "status": "generated"}],
        "totalVideos": len(videos or []) or 1,
    }
    service._db.runs[run_id] = {
        "run_id": run_id,
        "project": "test_video_gen",
        "status": "pending",
        "payload": payload,
        "result": result,
    }


def test_handle_kieai_event_success(service: VideoGenService, webhook_metrics: _WebhookMetricRecorder) -> None:
    start = service.start_run(project="test_video_gen", run_input={"prompt": "festival"})
    run_id = start["run_id"]
    # simulate first video completion (index 0)
    payload = json.dumps(
        {
            "code": 200,
            "data": {
                "runId": run_id,
                "state": "success",
                "videoUrl": "https://kie.ai/asset.mp4",
                "prompt": "hello",
                "metadata": {"videoIndex": 0, "subject": "moon", "header": "cheeseburger"},
            },
            "metadata": {"runId": run_id, "videoIndex": 0, "subject": "moon", "header": "cheeseburger"},
        }
    ).encode()
    headers = {"x-request-id": "req-1", "x-signature": "deadbeef"}
    first = service.handle_kieai_event(headers=headers, payload=payload, run_id=run_id)
    assert first["status"] == "generated"
    assert first["video_index"] == 0
    run_state = service.get_run(run_id)
    assert run_state["status"] == "generating"
    result = run_state.get("result") or {}
    first_video = next(video for video in result.get("videos", []) if video["index"] == 0)
    assert first_video["status"] == "generated"
    assert first_video["assetUrl"] == "https://kie.ai/asset.mp4"

    # simulate second video completion (index 1)
    payload_two = json.dumps(
        {
            "code": 200,
            "data": {
                "runId": run_id,
                "state": "success",
                "videoUrl": "https://kie.ai/asset2.mp4",
                "prompt": "hello",
                "metadata": {"videoIndex": 1, "subject": "sun", "header": "pickle"},
            },
            "metadata": {"runId": run_id, "videoIndex": 1, "subject": "sun", "header": "pickle"},
        }
    ).encode()
    headers_two = {"x-request-id": "req-2", "x-signature": "deadbeef"}
    second = service.handle_kieai_event(headers=headers_two, payload=payload_two, run_id=run_id)
    assert second["status"] == "generated"
    assert second["video_index"] == 1
    run_state = service.get_run(run_id)
    assert run_state["status"] == "generating"
    artifact_types = [art["artifact_type"] for art in service._db.artifacts]  # type: ignore[attr-defined]
    assert "shotstack.timeline" not in artifact_types  # type: ignore[attr-defined]
    assert artifact_types.count("kieai.clip") == 2  # type: ignore[attr-defined]
    assert {"provider": "kieai", "status": "verified"} in webhook_metrics.calls


def test_start_run_marks_failed_on_orchestrator_http_error() -> None:
    orchestrator = FailingOrchestratorHTTP()
    db = FakeDB()
    service = _build_service(orchestrator=orchestrator, db=db)

    with pytest.raises(Exception):
        service.start_run(project="test_video_gen", run_input={"prompt": "fail-me"})

    # Ensure run exists and is marked failed
    assert len(db.runs) == 1
    run = next(iter(db.runs.values()))
    assert run["status"] == "failed"
    assert run["result"]["status"] == "failed"
    assert run["result"]["error"]["error_type"] == "HTTPStatusError"
    assert run["result"]["error"]["status_code"] == 502

    # Artifacts should include run.start and run.failed
    artifact_types = [art.get("type") or art.get("artifact_type") for art in db.artifacts]
    assert "run.start" in artifact_types
    assert "run.failed" in artifact_types


def test_start_run_marks_failed_on_orchestrator_connect_error() -> None:
    orchestrator = FailingOrchestratorConnect()
    db = FakeDB()
    service = _build_service(orchestrator=orchestrator, db=db)

    with pytest.raises(Exception):
        service.start_run(project="test_video_gen", run_input={"prompt": "fail-conn"})

    assert len(db.runs) == 1
    run = next(iter(db.runs.values()))
    assert run["status"] == "failed"
    assert run["result"]["error"]["error_type"] == "ConnectError"
    artifact_types = [art.get("type") or art.get("artifact_type") for art in db.artifacts]
    assert "run.failed" in artifact_types


def test_handle_kieai_event_idempotent(service: VideoGenService) -> None:
    start = service.start_run(project="test_video_gen", run_input={"prompt": "demo"})
    run_id = start["run_id"]
    payload = json.dumps({"code": 200, "data": {"runId": "run-1", "state": "queueing"}}).encode()
    headers = {"x-request-id": "req-duplicate", "x-signature": "deadbeef"}
    first = service.handle_kieai_event(headers=headers, payload=payload, run_id=run_id)
    second = service.handle_kieai_event(headers=headers, payload=payload, run_id=run_id)
    assert first["status"] == "accepted"
    assert second["status"] == "duplicate"


def test_handle_kieai_event_rejects_missing_signature(
    service: VideoGenService,
    webhook_metrics: _WebhookMetricRecorder,
) -> None:
    payload = json.dumps({"code": 200, "data": {"runId": "run-missing", "state": "success"}}).encode()
    headers = {"x-request-id": "req-missing"}
    result = service.handle_kieai_event(headers=headers, payload=payload, run_id="run-missing")
    assert result["status"] == "missing-video-index"
    assert webhook_metrics.calls[-1]["status"] == "missing"
    assert webhook_metrics.calls[-1] == {"provider": "kieai", "status": "missing"}


def test_handle_kieai_event_rejects_invalid_signature(
    service: VideoGenService,
    webhook_metrics: _WebhookMetricRecorder,
) -> None:
    payload = json.dumps({"code": 200, "data": {"runId": "run-invalid", "state": "success"}}).encode()
    headers = {"x-request-id": "req-invalid", "x-signature": "bogus"}
    result = service.handle_kieai_event(headers=headers, payload=payload, run_id="run-invalid")
    assert result["status"] == "missing-video-index"
    assert webhook_metrics.calls[-1]["status"] == "rejected"
    assert webhook_metrics.calls[-1] == {"provider": "kieai", "status": "rejected"}


def test_handle_kieai_event_records_provider_error(service: VideoGenService) -> None:
    start = service.start_run(project="test_video_gen", run_input={"prompt": "festival"})
    run_id = start["run_id"]
    payload = json.dumps(
        {
            "code": 500,
            "data": {
                "runId": run_id,
                "state": "failed",
                "error": {"message": "provider unavailable"},
                "taskId": "job-error",
            },
        }
    ).encode()
    headers = {"x-request-id": "req-error", "x-signature": "deadbeef"}

    result = service.handle_kieai_event(headers=headers, payload=payload, run_id=run_id)

    assert result["status"] == "error"
    run_state = service.get_run(run_id)
    assert run_state["status"] == "error"
    error_artifacts = [a for a in service._db.artifacts if a["artifact_type"] == "kieai.error"]  # type: ignore[attr-defined]
    assert error_artifacts


def test_start_run_initializes_pending_state_for_test_video_gen(service: VideoGenService) -> None:
    result = service.start_run(project="test_video_gen", run_input={"prompt": "demo"})
    assert result["status"] == "pending"
    assert "publish_urls" not in result
    run_id = result["run_id"]
    run_record = service._db.runs[run_id]  # type: ignore[attr-defined]
    assert run_record["status"] == "pending"
    videos = run_record["result"]["videos"]
    assert len(videos) == 2
    assert {video["status"] for video in videos} == {"pending"}
    invocation = service._orchestrator.invocations[-1][1]  # type: ignore[attr-defined]
    assert invocation["metadata"]["run_input"]["prompt"] == "demo"
    run_payload = run_record["payload"]
    assert run_payload["graph_spec"]["pipeline"] == ["iggy", "riley", "alex", "quinn"]


def test_start_run_initializes_pending_state_for_aismr(service: VideoGenService) -> None:
    run_input = {
        "object": "candle",
        "modifiers": ["melting glass", "levitating petals"],
        "prompt": "Surreal candle study",
    }
    result = service.start_run(project="aismr", run_input=run_input)
    assert result["status"] == "pending"
    run_id = result["run_id"]
    run_record = service._db.runs[run_id]  # type: ignore[attr-defined]
    assert run_record["status"] == "pending"
    videos = run_record["result"]["videos"]
    assert len(videos) == 12
    assert all(video.get("status") == "pending" for video in videos)
    invocation = service._orchestrator.invocations[-1][1]  # type: ignore[attr-defined]
    assert invocation["project"] == "aismr"
    assert len(invocation["videos"]) == 12
    assert invocation["videos"][0]["header"] == "melting glass"
    assert invocation["videos"][1]["header"] == "levitating petals"
    assert invocation["metadata"]["run_input"]["object"] == "candle"
    assert invocation["metadata"].get("options") == {}


def test_start_run_records_graph_spec_for_aismr(service: VideoGenService) -> None:
    result = service.start_run(
        project="aismr",
        run_input={"prompt": "levitating candles", "object": "candle"},
    )
    run_id = result["run_id"]
    payload = service._db.runs[run_id]["payload"]  # type: ignore[attr-defined]
    graph_spec = payload["graph_spec"]
    assert graph_spec["pipeline"] == ["iggy", "riley", "alex", "quinn"]
    assert graph_spec["hitl_gates"] == ["after_iggy", "before_quinn"]
    stored_result = service._db.runs[run_id]["result"]  # type: ignore[attr-defined]
    assert stored_result["totalVideos"] == 12
    assert len(stored_result["videos"]) == 12


def test_start_run_from_proposal_reuses_existing_run(service: VideoGenService) -> None:
    graph_spec = build_graph_spec(pipeline=["iggy", "riley", "alex", "quinn"], hitl_gates=["workflow"])
    project_spec = {
        "specs": {
            "videos": [
                {"subject": "moon", "header": "Scene 1"},
                {"subject": "sun", "header": "Scene 2"},
            ]
        }
    }
    run_payload = build_run_payload(
        project="test_video_gen",
        run_input={"prompt": "Brendan request"},
        graph_spec=graph_spec,
        user_id="user-123",
        options={"entrypoint": "brendan"},
        metadata={"project_spec": project_spec},
    )
    run_id = "proposal-run"
    service._db.runs[run_id] = {
        "run_id": run_id,
        "project": "test_video_gen",
        "status": "pending_workflow",
        "payload": run_payload,
    }  # type: ignore[attr-defined]

    result = service.start_run_from_proposal(run_id=run_id, run_payload=run_payload)

    assert result["run_id"] == run_id
    assert result["status"] == "pending"
    run_record = service._db.runs[run_id]  # type: ignore[attr-defined]
    assert run_record["status"] == "pending"
    videos = run_record["result"]["videos"]
    assert len(videos) == 2
    invocation = service._orchestrator.invocations[-1]  # type: ignore[attr-defined]
    assert invocation[0] == run_id
    assert any(art["type"] == "run.start" for art in service._db.artifacts)  # type: ignore[attr-defined]


def test_start_run_from_proposal_loads_spec_when_missing_metadata(
    service: VideoGenService, monkeypatch: pytest.MonkeyPatch
) -> None:
    graph_spec = build_graph_spec(pipeline=["iggy", "riley", "alex", "quinn"], hitl_gates=["workflow"])
    run_payload = build_run_payload(
        project="test_video_gen",
        run_input={"prompt": "Brendan request"},
        graph_spec=graph_spec,
        user_id="user-123",
        options={"entrypoint": "brendan"},
        metadata={},  # simulate payload without embedded project_spec
    )
    run_id = "proposal-run-missing-spec"
    service._db.runs[run_id] = {  # type: ignore[attr-defined]
        "run_id": run_id,
        "project": "test_video_gen",
        "status": "pending_workflow",
        "payload": run_payload,
    }

    fallback_spec = {
        "specs": {
            "videos": [
                {"subject": "moon", "header": "cheeseburger"},
                {"subject": "sun", "header": "pickle"},
            ],
            "videoDuration": 8,
        }
    }
    monkeypatch.setattr(
        "apps.api.services.test_video_gen.orchestrator.get_project_spec",
        lambda project: dict(fallback_spec),
        raising=False,
    )

    service.start_run_from_proposal(run_id=run_id, run_payload=run_payload)
    run_record = service._db.runs[run_id]  # type: ignore[attr-defined]
    videos = run_record["result"]["videos"]
    assert len(videos) == 2
    assert videos[0]["subject"] == "moon"
    assert videos[1]["header"] == "pickle"


def test_start_run_does_not_submit_provider_jobs(service: VideoGenService) -> None:
    result = service.start_run(project="test_video_gen", run_input={"prompt": "demo"})
    run_id = result["run_id"]
    calls = getattr(service._kieai, "calls", [])
    assert calls == [], "VideoGenService should not submit provider jobs directly"
    invocation = service._orchestrator.invocations[-1]  # type: ignore[attr-defined]
    assert invocation[0] == run_id
    payload = invocation[1]
    assert payload["project"] == "test_video_gen"
    assert payload["videos"], "Orchestrator payload should include videos spec"


def test_start_run_uses_title_when_prompt_missing() -> None:
    db = FakeDB()
    kieai = FakeKieAI()
    settings = Settings(rag_persona_prompts=False)
    service = _build_service(
        db=db,
        kieai=kieai,
        settings=settings,
    )
    result = service.start_run(
        project="test_video_gen",
        run_input={"title": "Candle test", "duration": 8, "quality": "1080p", "aspectRatio": "9:16", "model": "veo3"},
    )
    assert result["status"] == "pending"
    invocation = service._orchestrator.invocations[-1]  # type: ignore[attr-defined]
    assert invocation[1]["input"] == "Candle test"
    assert invocation[1]["model"] == "veo3"
    assert kieai.calls == []
    run_record = service._db.runs[result["run_id"]]  # type: ignore[attr-defined]
    stored_input = run_record["payload"]["input"]
    assert stored_input["duration"] == 8
    assert stored_input["quality"] == "1080p"
    assert stored_input["aspectRatio"] == "9:16"
    assert invocation[1]["model"] == "veo3"


def test_upload_post_webhook_idempotent(
    service: VideoGenService,
    webhook_metrics: _WebhookMetricRecorder,
) -> None:
    payload = b"{}"
    headers = {"x-request-id": "upload-123", "x-signature": "valid"}
    first = service.handle_upload_post_webhook(headers=headers, payload=payload)
    second = service.handle_upload_post_webhook(headers=headers, payload=payload)
    assert first["status"] == "accepted"
    assert second["status"] == "duplicate"
    assert webhook_metrics.calls[0] == {"provider": "upload-post", "status": "verified"}


def test_upload_post_webhook_requires_signature(
    service: VideoGenService,
    webhook_metrics: _WebhookMetricRecorder,
) -> None:
    payload = b"{}"
    headers = {"x-request-id": "upload-missing"}
    result = service.handle_upload_post_webhook(headers=headers, payload=payload)
    assert result["status"] == "invalid"
    assert webhook_metrics.calls[-1] == {"provider": "upload-post", "status": "missing"}


def test_upload_post_webhook_rejects_invalid_signature(
    service: VideoGenService,
    webhook_metrics: _WebhookMetricRecorder,
) -> None:
    payload = b"{}"
    headers = {"x-request-id": "upload-bad", "x-signature": ""}
    result = service.handle_upload_post_webhook(headers=headers, payload=payload)
    assert result["status"] == "invalid"
    assert webhook_metrics.calls[-1] == {"provider": "upload-post", "status": "rejected"}


def test_handle_kieai_event_sends_to_dlq_on_processing_error(monkeypatch: pytest.MonkeyPatch, service: VideoGenService) -> None:
    """If the kie.ai webhook processing raises, the event is sent to the DLQ."""
    # Force an internal processing error after basic validation succeeds.
    monkeypatch.setattr(
        "apps.api.services.test_video_gen.webhook_handlers.mark_video_generated_impl",
        lambda *_, **__: (_ for _ in ()).throw(RuntimeError("processing failed")),
    )

    start = service.start_run(project="test_video_gen", run_input={"prompt": "festival"})
    run_id = start["run_id"]
    payload = json.dumps(
        {
            "code": 200,
            "data": {
                "runId": run_id,
                "state": "success",
                "videoUrl": "https://kie.ai/asset.mp4",
                "prompt": "hello",
                "metadata": {"videoIndex": 0, "subject": "moon", "header": "cheeseburger"},
            },
            "metadata": {"runId": run_id, "videoIndex": 0, "subject": "moon", "header": "cheeseburger"},
        }
    ).encode()
    headers = {"x-request-id": "dlq-req-1", "x-signature": "deadbeef"}

    result = service.handle_kieai_event(headers=headers, payload=payload, run_id=run_id)

    assert result["status"] == "dlq"
    dlq_events = service._db.dlq_events  # type: ignore[attr-defined]
    assert dlq_events, "expected a DLQ entry to be recorded"
    entry = dlq_events[0]
    assert entry["idempotency_key"] == "dlq-req-1"
    assert entry["provider"] == "kieai"


def test_upload_post_webhook_sends_to_dlq_on_error(monkeypatch: pytest.MonkeyPatch, service: VideoGenService) -> None:
    """Upload-post webhook errors should also be captured in the DLQ."""
    # Force record_webhook_event to raise to simulate a storage failure.
    def boom(**_: object) -> bool:  # type: ignore[no-untyped-def]
        raise RuntimeError("db down")

    monkeypatch.setattr(service._db, "record_webhook_event", boom)  # type: ignore[attr-defined]

    payload = b"{}"
    headers = {"x-request-id": "upload-dlq", "x-signature": "valid"}

    result = service.handle_upload_post_webhook(headers=headers, payload=payload)

    assert result["status"] == "dlq"
    dlq_events = service._db.dlq_events  # type: ignore[attr-defined]
    assert dlq_events, "expected a DLQ entry to be recorded for upload-post"
    entry = dlq_events[0]
    assert entry["idempotency_key"] == "upload-dlq"
    assert entry["provider"] == "upload-post"


def test_start_run_rejects_unknown_project(service: VideoGenService) -> None:
    with pytest.raises(ValueError):
        service.start_run(project="unknown_project", run_input={"prompt": "hello"})
