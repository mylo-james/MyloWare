"""Service coordinating the Test Video Gen pipeline."""
from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlencode

import httpx
from langsmith import traceable

from adapters.ai_providers.kieai.client import KieAIClient
from adapters.social.upload_post.client import UploadPostClient
from adapters.orchestration.mcp_client import MCPClient
from core.runs.schema import build_graph_spec, build_run_payload

from ...config import Settings
from ...orchestrator_client import OrchestratorClient
from ...projects import get_project_spec
from ...storage import Database
from .state_updates import (
    _coerce_result_dict,
    _extract_project_spec_from_payload,
    mark_video_generated_impl,
)
from .validator import (
    _derive_hitl_points,
    _derive_pipeline,
    _extract_generation_config,
    _extract_project_spec_from_payload,
    _extract_videos_spec,
)

logger = logging.getLogger("myloware.api.video_pipeline")

class VideoGenService:
    def __init__(
        self,
        *,
        db: Database,
        kieai: KieAIClient,
        upload_post: UploadPostClient,
        orchestrator: OrchestratorClient,
        mcp: MCPClient | None = None,
        webhook_base_url: str,
        settings: Settings,
        kieai_model: str | None = None,
        kieai_default_duration: int = 8,
        kieai_default_quality: str = "720p",
        kieai_default_aspect_ratio: str = "16:9",
        publish_on_clip_webhook: bool = False,
    ) -> None:
        self._db = db
        self._kieai = kieai
        self._upload_post = upload_post
        self._orchestrator = orchestrator
        self._mcp = mcp
        self._webhook_base_url = webhook_base_url.rstrip("/")
        self._settings = settings
        # Fall back to API settings.kieai_model if explicit override is not provided.
        self._kieai_model = kieai_model or getattr(settings, "kieai_model", "veo3_fast")
        self._kieai_default_duration = kieai_default_duration
        self._kieai_default_quality = kieai_default_quality
        self._kieai_default_aspect_ratio = kieai_default_aspect_ratio
        self._publish_on_clip_webhook = publish_on_clip_webhook

    @traceable(name="start_test_video_gen_run")
    def start_run(
        self,
        *,
        project: str,
        run_input: Mapping[str, Any],
        options: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        logger.info(
            "VideoGenService.start_run called",
            extra={"project": project, "run_input": run_input, "options": options},
        )
        supported_projects = {"test_video_gen", "aismr"}
        if project not in supported_projects:
            raise ValueError(f"Project '{project}' is not supported yet. Supported: {sorted(supported_projects)}")
        project_spec = get_project_spec(project)
        logger.info("Project spec loaded", extra={"project": project})
        run_input_dict = dict(run_input)
        options_dict = dict(options or {})
        videos_spec = _extract_videos_spec(project, project_spec, run_input_dict)
        specs_defaults = project_spec.get("specs") or {}
        default_aspect = str(specs_defaults.get("aspectRatio") or self._kieai_default_aspect_ratio)
        default_duration = int(specs_defaults.get("videoDuration") or self._kieai_default_duration)
        graph_spec = build_graph_spec(
            pipeline=_derive_pipeline(project=project, project_spec=project_spec),
            hitl_gates=_derive_hitl_points(project_spec),
        )
        generation = _extract_generation_config(
            run_input_dict,
            default_duration=default_duration,
            default_quality=self._kieai_default_quality,
            default_aspect_ratio=default_aspect,
            model=self._kieai_model,
        )
        run_id = str(uuid.uuid4())
        run_payload = build_run_payload(
            project=project,
            run_input=run_input_dict,
            graph_spec=graph_spec,
            user_id=(options_dict.get("user_id") or run_input_dict.get("user_id")),
            options=options_dict,
            metadata={"project_spec": project_spec},
        )
        return self._start_pipeline(
            run_id=run_id,
            project=project,
            project_spec=project_spec,
            graph_spec=graph_spec,
            run_payload=run_payload,
            videos_spec=videos_spec,
            generation=generation,
            run_input_dict=run_input_dict,
            options_dict=options_dict,
            skip_run_creation=False,
        )

    def start_run_from_proposal(
        self,
        *,
        run_id: str,
        run_payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        project = str(run_payload.get("project") or "")
        if not project:
            raise ValueError("Run payload missing project")
        run_input_dict = dict(run_payload.get("input") or {})
        options_dict = dict(run_payload.get("options") or {})
        graph_spec = dict(run_payload.get("graph_spec") or {})
        project_spec_override = _extract_project_spec_from_payload(run_payload)
        base_spec = get_project_spec(project)
        if project_spec_override:
            project_spec = dict(base_spec)
            project_spec.update(dict(project_spec_override))
        else:
            project_spec = base_spec
        videos_spec = _extract_videos_spec(project, project_spec, run_input_dict)
        specs_defaults = project_spec.get("specs") or {}
        default_aspect = str(specs_defaults.get("aspectRatio") or self._kieai_default_aspect_ratio)
        default_duration = int(specs_defaults.get("videoDuration") or self._kieai_default_duration)
        generation = _extract_generation_config(
            run_input_dict,
            default_duration=default_duration,
            default_quality=self._kieai_default_quality,
            default_aspect_ratio=default_aspect,
            model=self._kieai_model,
        )
        return self._start_pipeline(
            run_id=run_id,
            project=project,
            project_spec=project_spec,
            graph_spec=graph_spec,
            run_payload=dict(run_payload),
            videos_spec=videos_spec,
            generation=generation,
            run_input_dict=run_input_dict,
            options_dict=options_dict,
            skip_run_creation=True,
        )

    def _start_pipeline(
        self,
        *,
        run_id: str,
        project: str,
        project_spec: Mapping[str, Any],
        graph_spec: Mapping[str, Any],
        run_payload: Mapping[str, Any],
        videos_spec: list[dict[str, Any]],
        generation: Mapping[str, Any],
        run_input_dict: Mapping[str, Any],
        options_dict: Mapping[str, Any],
        skip_run_creation: bool,
    ) -> dict[str, Any]:
        logger.info(
            "Starting pipeline",
            extra={
                "run_id": run_id,
                "project": project,
                "video_count": len(videos_spec),
                "skip_run_creation": skip_run_creation,
            },
        )
        if not skip_run_creation:
            self._db.create_run(
                run_id=run_id,
                project=project,
                status="pending",
                payload=run_payload,
            )
            logger.info("Run record created", extra={"run_id": run_id})
        self._db.create_artifact(
            run_id=run_id,
            artifact_type="run.start",
            url=None,
            provider="api",
            checksum=None,
            metadata={"input": run_input_dict, "options": options_dict},
        )
        logger.info("run.start artifact created", extra={"run_id": run_id})
        try:
            if self._mcp:
                self._mcp.call(
                    "trace_update",
                    {
                        "traceId": run_id,
                        "projectId": project,
                        "instructions": generation["prompt"],
                        "metadata": {"runId": run_id, "project": project},
                    },
                )
        except Exception as exc:  # best effort; do not block pipeline
            logger.warning("MCP trace_update failed", extra={"run_id": run_id, "error": str(exc)})
        orchestrator_payload = {
            "input": generation["prompt"],
            "videos": videos_spec,
            "project": project,
            "model": generation["model"],
            "metadata": {
                "run_input": run_input_dict,
                "options": options_dict,
                "project": project,
            },
        }
        orchestrator_base_url = getattr(
            self._orchestrator,
            "_base_url",
            getattr(self._orchestrator, "base_url", "unknown"),
        )
        logger.info(
            "Preparing to invoke orchestrator",
            extra={
                "run_id": run_id,
                "project": project,
                "orchestrator_url": orchestrator_base_url,
                "video_count": len(videos_spec),
            },
        )
        # Helper to mark run failure and emit an artifact before re-raising
        def _mark_run_failed(error_type: str, message: str, status_code: int | None = None) -> None:
            error_metadata = {
                "error_type": error_type,
                "error_message": message,
                "project": project,
                "orchestrator_url": orchestrator_base_url,
            }
            if status_code is not None:
                error_metadata["status_code"] = status_code
            try:
                current_result = {
                    "project": project,
                    "status": "failed",
                    "error": error_metadata,
                }
                self._db.update_run(run_id=run_id, status="failed", result=current_result)
            except Exception:  # pragma: no cover - defensive; failure marking must not raise
                logger.warning("Failed to update run status to failed", extra={"run_id": run_id}, exc_info=True)
            try:
                self._db.create_artifact(
                    run_id=run_id,
                    artifact_type="run.failed",
                    url=None,
                    provider="api",
                    checksum=None,
                    metadata=error_metadata,
                )
            except Exception:  # pragma: no cover - best-effort audit trail
                logger.warning("Failed to persist run.failed artifact", extra={"run_id": run_id}, exc_info=True)
        try:
            response = self._orchestrator.invoke(run_id, orchestrator_payload, background=True)
            logger.info(
                "Orchestrator invoked successfully",
                extra={
                    "run_id": run_id,
                    "project": project,
                    "video_count": len(videos_spec),
                    "response": response,
                },
            )
        except httpx.HTTPStatusError as exc:
            logger.error(
                "CRITICAL: Orchestrator returned HTTP error",
                extra={
                    "run_id": run_id,
                    "project": project,
                    "status_code": exc.response.status_code,
                    "response_body": exc.response.text[:500],
                    "url": str(exc.request.url),
                },
                exc_info=exc,
            )
            _mark_run_failed("HTTPStatusError", str(exc), status_code=int(exc.response.status_code))
            raise
        except httpx.ConnectError as exc:
            logger.error(
                "CRITICAL: Cannot connect to orchestrator",
                extra={
                    "run_id": run_id,
                    "project": project,
                    "orchestrator_url": orchestrator_base_url,
                },
                exc_info=exc,
            )
            _mark_run_failed("ConnectError", str(exc))
            raise
        except Exception as exc:
            logger.error(
                "CRITICAL: Orchestrator invocation failed with unexpected error",
                extra={
                    "run_id": run_id,
                    "project": project,
                    "error_type": type(exc).__name__,
                },
                exc_info=exc,
            )
            # Re-raise so we don't hide the failure
            _mark_run_failed(type(exc).__name__, str(exc))
            raise
        self._db.update_run(
            run_id=run_id,
            status="pending",
            result={
                "project": project,
                "totalVideos": len(videos_spec),
                "videos": [
                    {
                        "index": idx,
                        "subject": video["subject"],
                        "header": video["header"],
                        "status": "pending",
                    }
                    for idx, video in enumerate(videos_spec)
                ],
            },
        )
        return {"run_id": run_id, "status": "pending"}

    def handle_kieai_event(
        self,
        *,
        headers: Mapping[str, str],
        payload: bytes,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        from .webhook_handlers import handle_kieai_event_impl

        return handle_kieai_event_impl(
            self,
            headers=headers,
            payload=payload,
            run_id=run_id,
            logger=logger,
        )

    def handle_upload_post_webhook(self, *, headers: Mapping[str, str], payload: bytes) -> dict[str, Any]:
        from .webhook_handlers import handle_upload_post_webhook_impl

        return handle_upload_post_webhook_impl(self, headers=headers, payload=payload)

    def get_run(self, run_id: str) -> Mapping[str, Any] | None:
        return self._db.get_run(run_id)

    def list_artifacts(self, run_id: str) -> list[Mapping[str, Any]]:
        return self._db.list_artifacts(run_id)

    def cancel_run(
        self,
        run_id: str,
        *,
        reason: str | None = None,
        actor: str | None = None,
    ) -> dict[str, Any]:
        record = self._db.get_run(run_id)
        if not record:
            raise ValueError(f"Run {run_id} not found")
        status = str(record.get("status") or "").lower()
        terminal_statuses = {"published", "failed", "cancelled", "completed"}
        if status in terminal_statuses:
            raise RuntimeError(f"Run {run_id} is already {status or 'complete'}")
        result = _coerce_result_dict(record.get("result"))
        result["status"] = "cancelled"
        self._db.update_run(run_id=run_id, status="cancelled", result=result)
        metadata = {
            "reason": reason or "cancelled via API",
            "actor": actor or "api",
        }
        try:
            self._db.create_artifact(
                run_id=run_id,
                artifact_type="run.cancelled",
                url=None,
                provider="api",
                checksum=None,
                metadata=metadata,
            )
        except Exception:  # pragma: no cover - best-effort audit trail
            logger.warning("Failed to persist run.cancelled artifact", extra={"run_id": run_id}, exc_info=True)
        return {"run_id": run_id, "status": "cancelled"}

    def _build_kieai_callback_url(self, run_id: str) -> str:
        query = urlencode({"run_id": run_id})
        return f"{self._webhook_base_url}/v1/webhooks/kieai?{query}"
