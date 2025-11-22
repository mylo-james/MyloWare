from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4
from urllib.parse import parse_qs, urlparse

import types

# Stub optional dependencies required by api.main import path
if "alembic" not in sys.modules:
    alembic_module = types.ModuleType("alembic")
    sys.modules["alembic"] = alembic_module

if "alembic.config" not in sys.modules:
    alembic_config = types.ModuleType("alembic.config")

    class DummyConfig:
        def __init__(self, _path: str) -> None:
            self.path = _path

    alembic_config.Config = DummyConfig
    sys.modules["alembic.config"] = alembic_config

if "alembic.script" not in sys.modules:
    alembic_script = types.ModuleType("alembic.script")

    class DummyScriptDirectory:
        @staticmethod
        def from_config(_cfg: object) -> "DummyScriptDirectory":
            return DummyScriptDirectory()

        def get_current_head(self) -> str:
            return "head"

    alembic_script.ScriptDirectory = DummyScriptDirectory
    sys.modules["alembic.script"] = alembic_script

if "alembic.runtime" not in sys.modules:
    sys.modules["alembic.runtime"] = types.ModuleType("alembic.runtime")

if "alembic.runtime.migration" not in sys.modules:
    alembic_runtime = types.ModuleType("alembic.runtime.migration")

    class DummyMigrationContext:
        @staticmethod
        def configure(_conn: object) -> "DummyMigrationContext":
            return DummyMigrationContext()

        def get_current_revision(self) -> str:
            return "head"

    alembic_runtime.MigrationContext = DummyMigrationContext
    sys.modules["alembic.runtime.migration"] = alembic_runtime

if "sqlalchemy" not in sys.modules:
    sqlalchemy_module = types.ModuleType("sqlalchemy")

    def create_engine(_dsn: str):  # noqa: ANN001
        class DummyEngine:
            def connect(self):
                class DummyConn:
                    def __enter__(self):
                        return self

                    def __exit__(self, *exc_info: object) -> None:
                        return None

                return DummyConn()

            def dispose(self) -> None:
                return None

        return DummyEngine()

    sqlalchemy_module.create_engine = create_engine
    sys.modules["sqlalchemy"] = sqlalchemy_module

if "psycopg" not in sys.modules:
    psycopg_module = types.ModuleType("psycopg")

    class DummyConnection:
        def __init__(self) -> None:
            pass

        def execute(self, *_args: object, **_kwargs: object):
            raise RuntimeError("psycopg connection not available in integration test stub")

    def connect(*_args: object, **_kwargs: object) -> DummyConnection:  # noqa: ANN001
        raise RuntimeError("psycopg connect called in integration stub")

    psycopg_module.connect = connect  # type: ignore[assignment]

    unique_violation = type("UniqueViolation", (Exception,), {})
    psycopg_errors = types.ModuleType("psycopg.errors")
    psycopg_errors.UniqueViolation = unique_violation  # type: ignore[attr-defined]
    sys.modules["psycopg.errors"] = psycopg_errors
    psycopg_module.errors = psycopg_errors  # type: ignore[attr-defined]

    psycopg_rows = types.ModuleType("psycopg.rows")

    def dict_row(*_args: object, **_kwargs: object) -> None:  # noqa: ANN001
        return None

    psycopg_rows.dict_row = dict_row  # type: ignore[attr-defined]
    sys.modules["psycopg.rows"] = psycopg_rows
    psycopg_module.rows = psycopg_rows  # type: ignore[attr-defined]

    sys.modules["psycopg"] = psycopg_module

if "opentelemetry" not in sys.modules:
    sys.modules["opentelemetry"] = types.ModuleType("opentelemetry")

if "opentelemetry.instrumentation" not in sys.modules:
    sys.modules["opentelemetry.instrumentation"] = types.ModuleType("opentelemetry.instrumentation")

if "opentelemetry.instrumentation.fastapi" not in sys.modules:
    otel_fastapi = types.ModuleType("opentelemetry.instrumentation.fastapi")

    class DummyFastAPIInstrumentor:
        @staticmethod
        def instrument_app(*_args: object, **_kwargs: object) -> None:
            return None

    otel_fastapi.FastAPIInstrumentor = DummyFastAPIInstrumentor
    sys.modules["opentelemetry.instrumentation.fastapi"] = otel_fastapi

if "opentelemetry.instrumentation.psycopg" not in sys.modules:
    otel_psycopg = types.ModuleType("opentelemetry.instrumentation.psycopg")

    class DummyPsycopgInstrumentor:
        @staticmethod
        def instrument(*_args: object, **_kwargs: object) -> None:
            return None

        @staticmethod
        def uninstrument(*_args: object, **_kwargs: object) -> None:
            return None

    otel_psycopg.PsycopgInstrumentor = DummyPsycopgInstrumentor
    sys.modules["opentelemetry.instrumentation.psycopg"] = otel_psycopg

if "opentelemetry.exporter" not in sys.modules:
    sys.modules["opentelemetry.exporter"] = types.ModuleType("opentelemetry.exporter")

if "opentelemetry.exporter.otlp" not in sys.modules:
    sys.modules["opentelemetry.exporter.otlp"] = types.ModuleType("opentelemetry.exporter.otlp")

if "opentelemetry.exporter.otlp.proto" not in sys.modules:
    sys.modules["opentelemetry.exporter.otlp.proto"] = types.ModuleType("opentelemetry.exporter.otlp.proto")

if "opentelemetry.exporter.otlp.proto.http" not in sys.modules:
    sys.modules["opentelemetry.exporter.otlp.proto.http"] = types.ModuleType("opentelemetry.exporter.otlp.proto.http")

if "opentelemetry.exporter.otlp.proto.http.trace_exporter" not in sys.modules:
    otlp_exporter = types.ModuleType("opentelemetry.exporter.otlp.proto.http.trace_exporter")

    class DummyOTLPSpanExporter:
        def __init__(self, *args: object, **kwargs: object) -> None:
            return None

    otlp_exporter.OTLPSpanExporter = DummyOTLPSpanExporter
    sys.modules["opentelemetry.exporter.otlp.proto.http.trace_exporter"] = otlp_exporter

if "opentelemetry.sdk" not in sys.modules:
    sys.modules["opentelemetry.sdk"] = types.ModuleType("opentelemetry.sdk")

if "opentelemetry.sdk.resources" not in sys.modules:
    otel_resources = types.ModuleType("opentelemetry.sdk.resources")

    class DummyResource:
        def __init__(self, attributes: dict[str, object]) -> None:
            self.attributes = attributes

    otel_resources.Resource = DummyResource
    sys.modules["opentelemetry.sdk.resources"] = otel_resources

if "opentelemetry.sdk.trace" not in sys.modules:
    otel_trace = types.ModuleType("opentelemetry.sdk.trace")

    class DummyTracerProvider:
        def __init__(self, *args: object, **kwargs: object) -> None:
            return None

        def add_span_processor(self, _processor: object) -> None:
            return None

    otel_trace.TracerProvider = DummyTracerProvider
    sys.modules["opentelemetry.sdk.trace"] = otel_trace

if "opentelemetry.sdk.trace.export" not in sys.modules:
    otel_trace_export = types.ModuleType("opentelemetry.sdk.trace.export")

    class DummyBatchSpanProcessor:
        def __init__(self, *args: object, **kwargs: object) -> None:
            return None

        def shutdown(self) -> None:
            return None

    otel_trace_export.BatchSpanProcessor = DummyBatchSpanProcessor
    sys.modules["opentelemetry.sdk.trace.export"] = otel_trace_export

if "prometheus_fastapi_instrumentator" not in sys.modules:
    prom_module = types.ModuleType("prometheus_fastapi_instrumentator")

    class DummyInstrumentator:
        def instrument(self, _app: object) -> "DummyInstrumentator":
            return self

        def expose(self, *_args: object, **_kwargs: object) -> None:
            return None

    prom_module.Instrumentator = DummyInstrumentator
    sys.modules["prometheus_fastapi_instrumentator"] = prom_module

if "langsmith" not in sys.modules:
    langsmith_module = types.ModuleType("langsmith")

    class DummyTraceable:
        def __call__(self, fn):
            return fn

    langsmith_module.traceable = lambda name=None: DummyTraceable()
    sys.modules["langsmith"] = langsmith_module

import pytest
from httpx import ASGITransport, AsyncClient

from apps.api.config import Settings, settings
from apps.api.deps import get_database, get_orchestrator_client, get_video_gen_service
from apps.api.main import app
from apps.api.services.test_video_gen import VideoGenService


class FakeDB:
    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.artifacts: list[dict] = []
        self.webhooks: set[str] = set()
        self.hitl_approvals: list[dict] = []

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

    def list_artifacts(self, run_id: str):  # type: ignore[no-untyped-def]
        return [art for art in self.artifacts if art["run_id"] == run_id]

    def record_webhook_event(self, *, idempotency_key: str, **kwargs):  # type: ignore[no-untyped-def]
        if idempotency_key in self.webhooks:
            return False
        self.webhooks.add(idempotency_key)
        return True

    def record_hitl_approval(  # type: ignore[no-untyped-def]
        self,
        *,
        run_id: str,
        gate: str,
        approver_ip: str | None = None,
        approver: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        record = {
            "run_id": run_id,
            "gate": gate,
            "ip": approver_ip,
            "approver": approver,
            "metadata": metadata or {},
        }
        self.hitl_approvals.append(record)


class FakeKieAI:
    expected_signature = "deadbeef"

    def __init__(self) -> None:
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
        return {
            "code": 200,
            "data": {
                "taskId": f"job-{run_id}-{index}",
                "runId": run_id,
                "model": model,
                "metadata": metadata,
            },
        }

    def verify_signature(self, payload: bytes, signature: str | None) -> bool:
        return signature == self.expected_signature

    def sign(self, payload: bytes) -> str:
        _ = payload
        return self.expected_signature


class FakeUploadPost:
    def publish(self, *, video_path: Path, caption: str, account_id: str | None = None, **_: object):  # type: ignore[no-untyped-def]
        return {
            "canonicalUrl": f"https://tiktok.example/{os.path.basename(video_path)}",
            "caption": caption,
            "accountId": account_id,
        }

    def verify_signature(self, payload: bytes, signature: str | None) -> bool:
        return bool(signature)


class FakeOrchestrator:
    def __init__(self) -> None:
        self.invocations: list[tuple[str, dict, dict[str, object]]] = []

    def invoke(self, run_id: str, payload, **kwargs):  # type: ignore[no-untyped-def]
        self.invocations.append((run_id, payload, kwargs))
        return {"run_id": run_id, "state": payload}


class HitlAwareFakeOrchestrator(FakeOrchestrator):
    """Orchestrator stub that marks runs as published when a HITL gate is approved."""

    def __init__(self, db: FakeDB) -> None:
        super().__init__()
        self._db = db

    def invoke(self, run_id: str, payload, background: bool = True):  # type: ignore[no-untyped-def]
        _ = background
        self.invocations.append((run_id, payload, {"background": background}))
        resume = payload.get("resume") if isinstance(payload, dict) else None
        if isinstance(resume, dict) and resume.get("approved"):
            run = self._db.get_run(run_id) or {}
            project = run.get("project", "test_video_gen")
            result = run.get("result") or {}
            total_videos = int(result.get("totalVideos") or 1)
            videos = [
                {"index": idx, "status": "published"}
                for idx in range(total_videos)
            ]
            publish_urls = [
                f"https://mock.video.myloware.com/{run_id}-{video['index']}"
                for video in videos
            ]
            self._db.update_run(
                run_id=run_id,
                status="published",
                result={
                    "project": project,
                    "videos": videos,
                    "publishUrls": publish_urls,
                },
            )
        return {"run_id": run_id, "state": payload}


@dataclass
class PipelineContext:
    service: VideoGenService
    db: FakeDB
    kieai: FakeKieAI
    upload_post: FakeUploadPost


@dataclass
class HitlPipelineContext:
    service: VideoGenService
    db: FakeDB
    orchestrator: HitlAwareFakeOrchestrator


@pytest.fixture()
def pipeline_context() -> Iterator[PipelineContext]:
    db = FakeDB()
    kieai = FakeKieAI()
    upload_post = FakeUploadPost()
    test_settings = Settings(rag_persona_prompts=False)
    service = VideoGenService(
        db=db,
        kieai=kieai,
        upload_post=upload_post,
        orchestrator=FakeOrchestrator(),
        webhook_base_url="http://localhost:8080",
        settings=test_settings,
    )
    app.dependency_overrides[get_video_gen_service] = lambda: service
    app.dependency_overrides[get_database] = lambda: db
    try:
        yield PipelineContext(service=service, db=db, kieai=kieai, upload_post=upload_post)
    finally:
        app.dependency_overrides.pop(get_video_gen_service, None)
        app.dependency_overrides.pop(get_database, None)


@pytest.fixture()
def hitl_pipeline_context() -> Iterator[HitlPipelineContext]:
    """Context used for HITL approval integration tests."""
    db = FakeDB()
    orchestrator = HitlAwareFakeOrchestrator(db=db)
    service = VideoGenService(
        db=db,
        kieai=FakeKieAI(),
        upload_post=FakeUploadPost(),
        orchestrator=orchestrator,
        webhook_base_url="http://localhost:8080",
        settings=Settings(rag_persona_prompts=False),
    )
    app.dependency_overrides[get_video_gen_service] = lambda: service
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_orchestrator_client] = lambda: orchestrator
    try:
        yield HitlPipelineContext(service=service, db=db, orchestrator=orchestrator)
    finally:
        app.dependency_overrides.pop(get_video_gen_service, None)
        app.dependency_overrides.pop(get_database, None)
        app.dependency_overrides.pop(get_orchestrator_client, None)


@pytest.mark.asyncio
async def test_e2e_pipeline_via_webhooks(pipeline_context: PipelineContext) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        start_response = await client.post(
            "/v1/runs/start",
            json={"project": "test_video_gen", "input": {"title": "Candle test"}},
            headers={"x-api-key": settings.api_key},
        )
        assert start_response.status_code == 200
        start_data = start_response.json()
        run_id = start_data["runId"]
        assert start_data["status"] == "pending"
        assert len(pipeline_context.kieai.calls) == 0

        def make_payload(index: int, url: str, subject: str, header: str) -> bytes:
            return json.dumps(
                {
                    "code": 200,
                    "data": {
                        "runId": run_id,
                        "state": "success",
                        "videoUrl": url,
                        "prompt": "Candle test",
                        "metadata": {"videoIndex": index, "subject": subject, "header": header},
                    },
                    "metadata": {"runId": run_id, "videoIndex": index, "subject": subject, "header": header},
                }
            ).encode()

        payload_one = make_payload(0, "https://kie.ai/assets-moon.mp4", "moon", "cheeseburger")
        webhook_headers = {
            "Content-Type": "application/json",
            "X-Request-Id": "event-123",
            "X-Timestamp": str(int(time.time())),
            "X-Signature": pipeline_context.kieai.sign(payload_one),
        }
        webhook_response = await client.post(
            f"/v1/webhooks/kieai?run_id={run_id}",
            content=payload_one,
            headers=webhook_headers,
        )
        resp_one = webhook_response.json()
        assert resp_one["status"] == "generated"
        assert resp_one["videoIndex"] == 0

        payload_two = make_payload(1, "https://kie.ai/assets-sun.mp4", "sun", "pickle")
        webhook_headers_two = {
            "Content-Type": "application/json",
            "X-Request-Id": "event-456",
            "X-Timestamp": str(int(time.time())),
            "X-Signature": pipeline_context.kieai.sign(payload_two),
        }
        webhook_response_two = await client.post(
            f"/v1/webhooks/kieai?run_id={run_id}",
            content=payload_two,
            headers=webhook_headers_two,
        )
        resp_two = webhook_response_two.json()
        assert resp_two["status"] == "generated"
        assert resp_two["videoIndex"] == 1

        duplicate = await client.post(
            f"/v1/webhooks/kieai?run_id={run_id}",
            content=payload_two,
            headers=webhook_headers_two,
        )
        assert duplicate.json()["status"] == "duplicate"

        status_response = await client.get(f"/v1/runs/{run_id}", headers={"x-api-key": settings.api_key})
        assert status_response.status_code == 200
        status = status_response.json()
        assert status["status"] == "generating"
        videos = status["result"]["videos"]
        assert all(video["status"] == "generated" for video in videos)
        assert videos[0]["assetUrl"] == "https://kie.ai/assets-moon.mp4"
        assert videos[1]["assetUrl"] == "https://kie.ai/assets-sun.mp4"
        artifact_types = {artifact["type"] for artifact in status["artifacts"]}
        assert artifact_types.issuperset({"run.start", "kieai.clip"})


def _build_kieai_payload(run_id: str, index: int, url: str, subject: str, header: str) -> bytes:
    return json.dumps(
        {
            "code": 200,
            "data": {
                "runId": run_id,
                "state": "success",
                "videoUrl": url,
                "prompt": subject,
                "metadata": {"videoIndex": index, "subject": subject, "header": header},
            },
            "metadata": {"runId": run_id, "videoIndex": index, "subject": subject, "header": header},
        }
    ).encode()


def _kieai_headers(kieai: FakeKieAI, request_id: str, payload: bytes) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-Request-Id": request_id,
        "X-Timestamp": str(int(time.time())),
        "X-Signature": kieai.sign(payload),
    }


@pytest.mark.asyncio
async def test_aismr_pipeline_via_webhooks(pipeline_context: PipelineContext) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        start_response = await client.post(
            "/v1/runs/start",
            json={
                "project": "aismr",
                "input": {
                    "prompt": "Impossible candles",
                    "object": "candle",
                    "modifiers": ["melting glass", "levitating petals"],
                },
            },
            headers={"x-api-key": settings.api_key},
        )
        assert start_response.status_code == 200
        start_data = start_response.json()
        assert start_data["status"] == "pending"
        run_id = start_data["runId"]
        run_record = pipeline_context.db.get_run(run_id)
        videos = run_record["result"]["videos"]
        assert len(videos) == 12

        for video in videos:
            index = int(video.get("index", 0))
            subject = video.get("subject") or "candle"
            header = video.get("header") or f"Variant {index}"
            asset_url = f"https://kie.ai/assets-aismr-{index:02d}.mp4"
            payload = _build_kieai_payload(run_id, index, asset_url, subject, header)
            headers = _kieai_headers(pipeline_context.kieai, f"aismr-{index}", payload)
            resp = await client.post(f"/v1/webhooks/kieai?run_id={run_id}", content=payload, headers=headers)
            assert resp.status_code == 200

        status_response = await client.get(f"/v1/runs/{run_id}", headers={"x-api-key": settings.api_key})
        assert status_response.status_code == 200
        status = status_response.json()
        assert status["project"] == "aismr"
        assert status["status"] == "generating"
        videos_result = status["result"]["videos"]
        assert len(videos_result) == 12
        assert {video["status"] for video in videos_result} == {"generated"}
        clip_artifacts = [art for art in status["artifacts"] if art["type"] == "kieai.clip"]
        assert len(clip_artifacts) == 12

@pytest.mark.asyncio
async def test_hitl_gate_end_to_end_with_mocks(hitl_pipeline_context: HitlPipelineContext) -> None:
    """Integration test: run hits ideate gate, approval resumes and publishes."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        start_response = await client.post(
            "/v1/runs/start",
            json={
                "project": "test_video_gen",
                "input": {
                    "prompt": "Create a cheerful reel",
                    "subject": "testing",
                },
            },
            headers={"x-api-key": settings.api_key},
        )
        assert start_response.status_code == 200
        start_data = start_response.json()
        run_id = start_data["runId"]
        assert start_data["status"] == "pending"

        # Generate a signed approval link for the ideate gate
        link_response = await client.get(
            f"/v1/hitl/link/{run_id}/ideate",
            headers={"x-api-key": settings.api_key},
        )
        assert link_response.status_code == 200
        link_payload = link_response.json()
        approval_url = link_payload["approvalUrl"]
        parsed = urlparse(approval_url)
        token_values = parse_qs(parsed.query).get("token") or []
        assert token_values
        token = token_values[0]

        # Approve the ideate gate via HITL endpoint
        approve_response = await client.get(
            f"/v1/hitl/approve/{run_id}/ideate",
            params={"token": token},
            headers={"x-api-key": settings.api_key},
        )
        assert approve_response.status_code == 200
        approve_payload = approve_response.json()
        assert approve_payload["status"] == "approved"
        assert approve_payload["runId"] == run_id
        assert approve_payload["gate"] == "ideate"

        # The orchestrator should have been invoked at least twice:
        # once on start, once on approval with a resume payload.
        assert len(hitl_pipeline_context.orchestrator.invocations) >= 2
        last_run_id, last_payload, _ = hitl_pipeline_context.orchestrator.invocations[-1]
        assert last_run_id == run_id
        assert last_payload.get("resume", {}).get("gate") == "ideate"
        assert last_payload.get("resume", {}).get("approved") is True

        # HITL approval should be recorded and the run marked as published
        assert hitl_pipeline_context.db.hitl_approvals
        approval_record = hitl_pipeline_context.db.hitl_approvals[0]
        assert approval_record["run_id"] == run_id
        assert approval_record["gate"] == "ideate"

        status_response = await client.get(
            f"/v1/runs/{run_id}",
            headers={"x-api-key": settings.api_key},
        )
        assert status_response.status_code == 200
        status = status_response.json()
        assert status["status"] == "published"
        result = status.get("result") or {}
        publish_urls = result.get("publishUrls") or []
        assert publish_urls
