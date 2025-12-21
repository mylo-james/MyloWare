"""External service webhook handlers.

These endpoints receive callbacks from external services (OpenAI Sora, Remotion)
when async operations complete. They update run status and trigger the next
workflow step.

Flow:
1. Producer submits to OpenAI Sora → Run status = AWAITING_VIDEO_GENERATION
2. OpenAI Sora webhook (this file) → Store clips → When all ready, trigger Editor
3. Editor submits to Remotion → Run status = AWAITING_RENDER
4. Remotion webhook (this file) → Store video → Trigger publish approval
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from myloware.api.schemas import RemotionWebhookResponse, WebhookAck

from myloware.api.dependencies_async import get_async_artifact_repo, get_async_run_repo
from myloware.config.provider_modes import effective_remotion_provider, effective_sora_provider
from myloware.config.settings import settings
from myloware.observability.logging import get_logger
from myloware.services.openai_videos import download_openai_video_content_to_tempfile
from myloware.services.remotion_urls import normalize_remotion_output_url
from myloware.services.transcode import transcode_video
from myloware.storage.models import ArtifactType, RunStatus
from myloware.storage.repositories import ArtifactRepository, JobRepository, RunRepository
from myloware.workers.job_types import (
    JOB_WEBHOOK_REMOTION,
    JOB_WEBHOOK_SORA,
    idempotency_remotion_webhook,
    idempotency_sora_webhook,
)

logger = get_logger("api.webhooks")


router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])


def _get_first_header(request: Request, header_names: list[str]) -> str | None:
    """Return the first non-empty header value from the list."""
    for name in header_names:
        value = request.headers.get(name)
        if value:
            return value
    return None


def _verify_webhook_signature(
    payload: bytes,
    signature: str | None,
    secret: str,
    source: str,
    header_name: str = "X-Signature",
    algorithm: str = "sha256",
) -> bool:
    """Verify webhook signature using HMAC.

    Supports both SHA-256 (OpenAI Sora) and SHA-512 (Remotion) algorithms.

    Args:
        payload: Raw request body bytes.
        signature: Signature from request header.
        secret: Shared secret for HMAC.
        source: External system sending the webhook (for structured logs).
        header_name: Name of the signature header (for logging).
        algorithm: Hash algorithm - "sha256" or "sha512" (default: sha256).

    Returns:
        True if signature is valid.
        False if signature is invalid or missing.

    Raises:
        HTTPException: If secret is missing in production/non-dev mode.
    """
    bound_logger = logger.bind(source=source, header_name=header_name, algorithm=algorithm)

    if not secret:
        # Only skip verification when the provider is non-real (fake/off) or in test mode.
        provider_mode = "real"
        if source == "sora":
            provider_mode = effective_sora_provider(settings)
        elif source == "remotion":
            provider_mode = effective_remotion_provider(settings)

        if provider_mode != "real" or settings.disable_background_workflows:
            bound_logger.info(
                "webhook_signature_skipped",
                reason="missing_secret_non_real_provider",
                provider_mode=provider_mode,
            )
            return True
        else:
            bound_logger.error(
                "webhook_secret_required",
                reason="missing_secret_in_production",
                source=source,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Webhook secret not configured for {source}. "
                f"Set {source.upper()}_SIGNING_SECRET or {source.upper()}_WEBHOOK_SECRET.",
            )

    if not signature:
        bound_logger.warning(
            "invalid_webhook_signature",
            reason="missing_signature",
        )
        return False

    # Normalize signature - remove algorithm prefix if present
    if algorithm == "sha256":
        prefix = "sha256="
        hash_func = hashlib.sha256
    elif algorithm == "sha512":
        prefix = "sha512="
        hash_func = hashlib.sha512
    else:
        bound_logger.error(
            "invalid_webhook_signature",
            reason=f"unsupported_algorithm_{algorithm}",
        )
        return False

    normalized_signature = signature[len(prefix) :] if signature.startswith(prefix) else signature

    # Compute expected signature
    expected = hmac.new(
        secret.encode("utf-8"),
        payload,
        hash_func,
    ).hexdigest()

    if hmac.compare_digest(expected, normalized_signature):
        bound_logger.info(
            "webhook_signature_verified",
            digest_algorithm=algorithm,
        )
        return True

    bound_logger.warning(
        "invalid_webhook_signature",
        reason="mismatch",
        algorithm=algorithm,
    )
    return False


def _parse_run_id(raw: Any) -> UUID:
    """Parse and validate run_id from webhook payload."""
    try:
        return UUID(str(raw))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid run_id"
        ) from exc


async def _lookup_task_metadata(
    artifact_repo: ArtifactRepository,
    run_id: UUID,
    task_id: str,
) -> Dict[str, Any] | None:
    """Look up cache metadata for a task_id from stored mapping.

    The Sora tool stores task_id -> metadata mapping in a CLIP_MANIFEST artifact
    since OpenAI Sora doesn't return custom metadata in callbacks.
    """
    import json

    try:
        artifacts = await artifact_repo.get_by_run_async(run_id)
        manifests = [
            a
            for a in artifacts
            if a.artifact_type == ArtifactType.CLIP_MANIFEST.value
            and a.artifact_metadata
            and a.artifact_metadata.get("type") == "task_metadata_mapping"
            and a.content
        ]
        if not manifests:
            return None

        # Artifacts are ordered by created_at ascending; last is the active manifest.
        latest = manifests[-1]
        task_mapping = json.loads(latest.content or "{}")
        if isinstance(task_mapping, dict) and task_id in task_mapping:
            value = task_mapping[task_id]
            return value if isinstance(value, dict) else None
        return None
    except Exception as e:
        logger.warning("Failed to lookup task metadata: %s", e)
        return None


def _parse_video_urls(data: Dict[str, Any]) -> list[str]:
    """Extract video URLs from OpenAI Sora callback data."""
    # Sora returns resultUrls as JSON string
    result_urls = data.get("resultUrls") or data.get("info", {}).get("resultUrls")
    if isinstance(result_urls, str):
        try:
            return json.loads(result_urls)
        except json.JSONDecodeError:
            return [result_urls] if result_urls else []
    elif isinstance(result_urls, list):
        return result_urls

    # Fallback to single URL fields
    video_url = (
        data.get("videoUrl") or data.get("video_url") or data.get("info", {}).get("videoUrl")
    )
    return [video_url] if video_url else []


async def _expected_clip_count_async(artifact_repo: ArtifactRepository, run_id: UUID) -> int:
    artifacts = await artifact_repo.get_by_run_async(run_id)
    manifests = [
        a
        for a in artifacts
        if a.artifact_type == ArtifactType.CLIP_MANIFEST.value
        and a.artifact_metadata
        and a.artifact_metadata.get("type") == "task_metadata_mapping"
    ]
    if not manifests:
        return 1
    latest = manifests[-1]
    meta = latest.artifact_metadata or {}
    expected = meta.get("task_count")
    try:
        return int(expected) if expected is not None else 1
    except Exception:
        return 1


async def _ready_clip_count_async(artifact_repo: ArtifactRepository, run_id: UUID) -> int:
    artifacts = await artifact_repo.get_by_run_async(run_id)
    return sum(1 for a in artifacts if a.artifact_type == ArtifactType.VIDEO_CLIP.value)


async def _resume_langgraph_after_videos(run_id: UUID) -> None:
    """Resume LangGraph workflow after video clips are ready using checkpoint replay."""
    from myloware.workflows.langgraph.resume import resume_after_videos

    await resume_after_videos(run_id)


async def _resume_langgraph_after_render(run_id: UUID, video_url: str) -> None:
    """Resume LangGraph workflow after render is complete using checkpoint replay."""
    from myloware.workflows.langgraph.resume import resume_after_render

    await resume_after_render(run_id, video_url)


async def _update_run_after_render(run_id: UUID, video_url: str | None = None) -> None:
    """Internal function to update run status after render completion."""
    # Update status and store video URL in artifacts for publisher
    logger.info("Render complete, awaiting publish approval: %s", run_id)
    from myloware.storage.database import get_async_session_factory

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        artifact_repo = ArtifactRepository(session)

        # If video_url not provided, look it up from artifacts
        # Get the LATEST rendered_video artifact that has a URI
        if not video_url:
            artifacts = await artifact_repo.get_by_run_async(run_id)
            rendered_artifacts = [
                a
                for a in artifacts
                if a.artifact_type == ArtifactType.RENDERED_VIDEO.value and a.uri
            ]
            # Get the most recent one (artifacts are ordered by created_at)
            rendered = rendered_artifacts[-1] if rendered_artifacts else None
            video_url = rendered.uri if rendered else None

        # Store video URL in run artifacts for publisher to use
        if video_url:
            if hasattr(run_repo, "add_artifact_async"):
                await run_repo.add_artifact_async(run_id, "video", video_url)

        await run_repo.update_async(run_id, status=RunStatus.AWAITING_PUBLISH_APPROVAL.value)
        await session.commit()  # Persist the status change


@router.post("/sora", response_model=WebhookAck)
async def sora_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    run_repo: RunRepository = Depends(get_async_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_async_artifact_repo),
) -> Dict[str, Any]:
    """Handle OpenAI video generation webhooks (Sora).

    OpenAI emits Standard Webhooks events like:
      - type="video.completed" with data.id=<video_id>
      - type="video.failed" with data.id=<video_id>

    We look up the owning run_id via the per-run CLIP_MANIFEST mapping (task_id -> metadata),
    then enqueue processing to workers (or process in-process) to download/transcode and
    resume LangGraph.

    Security layers:
    1. Signature verification (Standard Webhooks)
    2. Run ID resolution + validation (via stored manifest mapping)
    3. Task ID validation (matches submitted task)
    4. Idempotency (prevent duplicate processing)
    5. Payload validation (structure and content)
    """
    body = await request.body()

    provider_mode = effective_sora_provider(settings)

    # Prefer the OpenAI Standard Webhooks secret; keep OPENAI_SORA_SIGNING_SECRET as a
    # backwards-compatible alias.
    sora_secret = (
        getattr(settings, "openai_standard_webhook_secret", None)
        or getattr(settings, "openai_sora_signing_secret", None)
        or ""
    )

    # Security Layer 1: Standard Webhooks signature verification (fail closed in real mode).
    if provider_mode == "real" and not settings.disable_background_workflows:
        if not sora_secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="OPENAI_SORA_SIGNING_SECRET or OPENAI_STANDARD_WEBHOOK_SECRET must be configured",
            )
        try:
            from openai import OpenAI

            # verify_signature does not require a valid API key, but the client ctor does.
            api_key = getattr(settings, "openai_api_key", "") or "missing"
            OpenAI(api_key=api_key).webhooks.verify_signature(
                payload=body,
                headers=request.headers,
                secret=sora_secret,
            )
            logger.info("Sora webhook signature verified (Standard Webhooks)")
        except Exception:
            logger.warning("Sora webhook signature verification failed")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid webhook signature",
            )

    # Optional legacy: allow run_id in query params for backwards compatibility.
    run_id_raw = request.query_params.get("run_id")
    run_id: UUID | None = _parse_run_id(run_id_raw) if run_id_raw else None

    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")

    # In tests we accept a simplified payload like {"urls": [...]}
    if settings.disable_background_workflows and "code" not in payload:
        payload = {
            "code": 200,
            "data": {"info": {"resultUrls": payload.get("urls") or payload.get("resultUrls")}},
        }

    # Webhook payloads can be large and may include sensitive data; default to logging only
    # safe metadata unless explicitly enabled for debugging.
    if settings.log_webhook_payloads:
        logger.info("sora_webhook_payload_raw", payload=payload)
    else:
        logger.debug("sora_webhook_payload_received", keys=sorted(payload.keys()))

    event_type: str | None = None
    task_id: str | None = None
    code: int | None = None
    state: str | None = None
    status_msg = ""
    metadata: dict[str, Any] = {}
    video_urls: list[str] = []

    # OpenAI Standard Webhooks event envelope (expected).
    if isinstance(payload, dict) and payload.get("object") == "event":
        raw_type = payload.get("type")
        event_type = raw_type if isinstance(raw_type, str) else None
        data_obj = payload.get("data")
        if isinstance(data_obj, dict):
            raw_id = data_obj.get("id")
            if isinstance(raw_id, str):
                # Prefer obvious video ids; ignore event ids like evt_*
                if raw_id.startswith("evt_"):
                    task_id = None
                else:
                    task_id = raw_id

            # Some webhook shapes nest the resource under data.object
            nested_obj = data_obj.get("object")
            if isinstance(nested_obj, dict):
                nested_id = nested_obj.get("id") or nested_obj.get("video_id")
                if isinstance(nested_id, str) and nested_id:
                    task_id = nested_id
            elif isinstance(nested_obj, str):
                # If object is a type label (e.g., "video"), fall back to data.video_id
                nested_id = data_obj.get("video_id")
                if isinstance(nested_id, str) and nested_id:
                    task_id = nested_id

        if event_type == "video.completed":
            code = 200
            state = "success"
            status_msg = "video.completed"
        elif event_type == "video.failed":
            code = 500
            state = "fail"
            status_msg = "video.failed"
        else:
            # Ignore unrelated event types
            return WebhookAck(status="ignored", run_id=str(run_id) if run_id else None).model_dump()

        if not task_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing data.id")

        # Resolve run_id via stored manifest mapping when not provided in query params.
        resolved_meta: dict[str, Any] | None = None
        if run_id is None:
            resolved = await artifact_repo.find_run_for_sora_task_async(task_id)
            if resolved is not None:
                run_id, resolved_meta = resolved

        if run_id is None:
            # In production, returning a 4xx causes OpenAI to retry delivery, potentially
            # for hours. If the task_id is unknown (often because it's stale after a repair),
            # ACK + ignore after signature verification to prevent retry storms.
            logger.warning("sora_webhook_unknown_task_id", task_id=task_id, reason="no_run_mapping")
            if settings.disable_background_workflows:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unknown task_id (no run mapping)",
                )
            return WebhookAck(
                status="ignored",
                run_id=None,
                task_id=task_id,
                error="Unknown task_id (no run mapping)",
            ).model_dump()

        # Prefer payload metadata if present (rare), else use stored mapping.
        if isinstance(resolved_meta, dict):
            metadata = resolved_meta

    else:
        # Legacy (pre-standard-webhooks) callback format (kept for backwards compatibility).
        if run_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing run_id query parameter",
            )

        data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
        info = data.get("info", {}) if isinstance(data.get("info"), dict) else {}
        raw_metadata = data.get("metadata") or payload.get("metadata") or {}
        metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
        code = payload.get("code")
        status_msg = payload.get("msg", "")
        task_id = data.get("taskId") or payload.get("taskId")
        state = data.get("state") or payload.get("state")

        result_json_raw = data.get("resultJson") or payload.get("resultJson")
        result_json: dict[str, Any] = {}
        if isinstance(result_json_raw, str):
            try:
                result_json = json.loads(result_json_raw)
            except json.JSONDecodeError:
                logger.warning("Sora webhook: failed to parse resultJson string")
        elif isinstance(result_json_raw, dict):
            result_json = result_json_raw

        # Get video URLs from data.info.resultUrls (legacy format)
        raw_video_urls: Any = info.get("resultUrls") or info.get("result_urls")
        if not raw_video_urls and result_json:
            raw_video_urls = result_json.get("resultUrls") or result_json.get("result_urls")

        if isinstance(raw_video_urls, str):
            try:
                parsed_urls = json.loads(raw_video_urls)
            except json.JSONDecodeError:
                video_urls = [raw_video_urls] if raw_video_urls else []
            else:
                if isinstance(parsed_urls, list):
                    video_urls = [str(u) for u in parsed_urls if u]
                elif isinstance(parsed_urls, str):
                    video_urls = [parsed_urls] if parsed_urls else []
                else:
                    video_urls = []
        elif isinstance(raw_video_urls, list):
            video_urls = [str(u) for u in raw_video_urls if u]
        else:
            video_urls = []

    # Security Layer 3: Task ID validation
    # Verify this task_id was actually submitted by us
    cached_metadata: Dict[str, Any] | None = None
    if task_id:
        cached_metadata = await _lookup_task_metadata(artifact_repo, run_id, task_id)
        if not cached_metadata:
            logger.warning(
                "OpenAI Sora webhook for unknown task_id",
                run_id=str(run_id),
                task_id=task_id,
            )
            # ACK + ignore unknown tasks in real processing mode to prevent provider retry storms.
            if not settings.disable_background_workflows:
                return WebhookAck(
                    status="ignored",
                    run_id=str(run_id),
                    task_id=task_id,
                    error="Unknown task_id (not in active manifest)",
                ).model_dump()
        else:
            logger.info(
                "OpenAI Sora webhook task_id validated",
                run_id=str(run_id),
                task_id=task_id,
            )

    if (not metadata) and cached_metadata:
        metadata = cached_metadata

    video_index = 0
    if isinstance(metadata, dict):
        video_index = int(
            metadata.get("videoIndex") or metadata.get("video_index") or metadata.get("idx") or 0
        )

    # Security Layer 4: Idempotency check
    # Check if we've already processed this task_id for this run
    if task_id:
        existing_artifacts = await artifact_repo.get_by_run_async(run_id)
        for artifact in existing_artifacts:
            if (
                artifact.artifact_type == ArtifactType.VIDEO_CLIP.value
                and artifact.artifact_metadata
                and artifact.artifact_metadata.get("task_id") == task_id
            ):
                logger.info(
                    "OpenAI Sora webhook already processed (idempotency)",
                    run_id=str(run_id),
                    task_id=task_id,
                )
                return {
                    "status": "accepted",
                    "run_id": str(run_id),
                    "task_id": task_id,
                    "message": "Already processed",
                }

    logger.info(
        "Sora webhook parsed",
        extra={
            "run_id": str(run_id),
            "task_id": task_id,
            "code": code,
            "status_msg": status_msg,
            "state": state,
            "event_type": event_type,
            "has_video_urls": len(video_urls) > 0,
            "video_index": video_index,
        },
    )

    is_failure = (
        bool(code is not None and code != 200) or state == "fail" or event_type == "video.failed"
    )
    is_completion = bool(video_urls) or event_type == "video.completed"

    # Fast path for tests: just acknowledge without DB side effects
    if settings.disable_background_workflows:
        if is_failure or not is_completion:
            error_msg = status_msg or "Video generation failed"
            return {"status": "error", "run_id": str(run_id), "error": error_msg}

        video_url = str(video_urls[0]) if video_urls else None
        return {
            "status": "accepted",
            "run_id": str(run_id),
            "video_index": video_index,
            "video_url": video_url,
        }

    # Scale mode: enqueue webhook processing to workers and ACK immediately.
    if settings.workflow_dispatcher == "db":
        job_repo = JobRepository(run_repo.session)
        idem = idempotency_sora_webhook(run_id, str(task_id) if task_id else None)
        if not idem:
            idem = f"sora:{run_id}:hash:{hashlib.sha256(body).hexdigest()}"
        try:
            await job_repo.enqueue_async(
                JOB_WEBHOOK_SORA,
                run_id=run_id,
                payload={
                    "code": code,
                    "state": state,
                    "status_msg": status_msg,
                    "task_id": task_id,
                    "video_index": video_index,
                    "video_urls": video_urls,
                    "metadata": metadata,
                    "event_type": event_type,
                },
                idempotency_key=idem,
                max_attempts=settings.job_max_attempts,
            )
            await run_repo.session.commit()
        except ValueError:
            # Enqueue is idempotent; a unique constraint violation leaves the
            # session in a rollback-only state on SQLite/Postgres.
            await run_repo.session.rollback()
        ack = WebhookAck(
            status="accepted",
            run_id=str(run_id),
            task_id=str(task_id) if task_id else None,
            video_index=video_index,
            video_url=str(video_urls[0]) if video_urls else None,
        )
        return ack.model_dump()

    # Check for failure
    if is_failure:
        error_msg = status_msg or "Video generation failed"
        logger.error("Sora video generation failed: %s", error_msg)
        await run_repo.update_async(
            run_id,
            status=RunStatus.FAILED.value,
            error=f"OpenAI Sora error: {error_msg}",
        )
        await run_repo.session.commit()
        return {"status": "error", "run_id": str(run_id), "error": error_msg}

    # If not a completion, treat as progress callback (not completion)
    if not is_completion:
        logger.info("Sora progress callback (no video URLs yet): %s", task_id)
        return {"status": "pending", "run_id": str(run_id), "task_id": task_id}

    # We have video URLs - this is a completion callback!
    logger.info("Sora completion callback (event_type=%s, urls=%d)", event_type, len(video_urls))
    original_url = str(video_urls[0]) if video_urls else ""
    downloaded_path: Path | None = None
    if not original_url and event_type == "video.completed":
        if provider_mode == "fake":
            # Fake provider: synthesize the local fixture URL so transcode passthrough works.
            base = str(getattr(settings, "webhook_base_url", "") or "").rstrip("/")
            if base:
                original_url = f"{base}/v1/media/sora/{task_id}.mp4"
        else:
            try:
                downloaded_path = await download_openai_video_content_to_tempfile(
                    str(task_id or "")
                )
                original_url = downloaded_path.as_uri()
            except Exception as exc:
                error_msg = f"OpenAI video download failed: {exc}"
                logger.error(
                    "OpenAI video download failed for run %s (task_id=%s): %s",
                    run_id,
                    task_id,
                    exc,
                )
                await run_repo.update_async(
                    run_id,
                    status=RunStatus.FAILED.value,
                    error=error_msg,
                )
                await run_repo.session.commit()
                return {
                    "status": "error",
                    "run_id": str(run_id),
                    "task_id": task_id,
                    "error": error_msg,
                }

    if not original_url:
        error_msg = "Sora webhook missing video URL and no downloadable content available"
        logger.error("Sora completion missing video URL for run %s (task_id=%s)", run_id, task_id)
        await run_repo.update_async(
            run_id,
            status=RunStatus.FAILED.value,
            error=error_msg,
        )
        await run_repo.session.commit()
        return {"status": "error", "run_id": str(run_id), "task_id": task_id, "error": error_msg}

    # Transcode video to Remotion-compatible format (H.264/AAC)
    # OpenAI Sora videos often have codec issues that Chromium can't decode
    try:
        transcoded_url = await transcode_video(original_url, run_id, video_index)
    finally:
        if downloaded_path is not None:
            try:
                downloaded_path.unlink(missing_ok=True)
            except Exception:
                logger.debug(
                    "openai_video_download_cleanup_failed",
                    run_id=str(run_id),
                    task_id=str(task_id or ""),
                )
    if not transcoded_url:
        error_msg = "Transcode failed (ffmpeg missing or codec error)"
        logger.error(
            "Transcode failed for run %s (task_id=%s, original_url=%s)",
            run_id,
            task_id,
            original_url,
        )
        await run_repo.update_async(
            run_id,
            status=RunStatus.FAILED.value,
            error=error_msg,
        )
        await run_repo.session.commit()
        return {"status": "error", "run_id": str(run_id), "task_id": task_id, "error": error_msg}

    video_url = transcoded_url
    logger.info("Using transcoded video: %s", transcoded_url)

    # Build artifact metadata including cache info
    artifact_metadata = {
        "task_id": task_id,
        "video_index": video_index,
        "source": "sora",
    }

    if metadata.get("topic"):
        artifact_metadata["topic"] = metadata["topic"]
    if metadata.get("sign"):
        artifact_metadata["sign"] = metadata["sign"]
    if metadata.get("object_name"):
        artifact_metadata["object_name"] = metadata["object_name"]

    if not artifact_metadata.get("topic") and task_id:
        cache_meta = await _lookup_task_metadata(artifact_repo, run_id, task_id)
        if cache_meta:
            artifact_metadata.update(cache_meta)
            logger.info("Retrieved cache metadata for task %s from stored mapping", task_id)

    await artifact_repo.create_async(
        run_id=run_id,
        persona="producer",
        artifact_type=ArtifactType.VIDEO_CLIP,
        uri=video_url,
        metadata=artifact_metadata,
    )

    run = await run_repo.get_for_update_async(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    clip_count = await _ready_clip_count_async(artifact_repo, run_id)
    expected_count = await _expected_clip_count_async(artifact_repo, run_id)

    logger.info(
        "Video clip %d/%d received for run %s",
        clip_count,
        expected_count,
        run_id,
    )

    if clip_count >= expected_count:
        logger.info("All %d clips ready for run %s (status=%s)", expected_count, run_id, run.status)

        # Never auto-resume a run that is explicitly failed. Operators can still
        # fork/resume manually from checkpoints if desired.
        if run.status == RunStatus.FAILED.value:
            logger.info("Run is FAILED; skipping auto-resume after Sora clips (run_id=%s)", run_id)
            await run_repo.session.commit()
        else:
            # Best-effort projection update for legacy consumers; the LangGraph
            # wrapper will snapshot the authoritative state after resume.
            if run.status == RunStatus.AWAITING_VIDEO_GENERATION.value:
                await run_repo.update_async(run_id, status=RunStatus.AWAITING_RENDER.value)
            await run_repo.session.commit()

            # Resume LangGraph workflow even if the run.status projection is stale.
            # This avoids fake-provider races where the webhook can arrive before
            # the producer updates status to AWAITING_VIDEO_GENERATION.
            if not settings.disable_background_workflows:
                background_tasks.add_task(_resume_langgraph_after_videos, run_id)
    else:
        await run_repo.session.commit()

    ack = WebhookAck(
        status="accepted",
        run_id=str(run_id),
        video_index=video_index,
        video_url=video_url,
    )
    return ack.model_dump()


@router.post("/remotion", response_model=RemotionWebhookResponse)
async def remotion_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    run_repo: RunRepository = Depends(get_async_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_async_artifact_repo),
) -> Dict[str, Any]:
    """Handle Remotion render completion callbacks.

    Remotion service sends a callback when a render job completes. We persist the
    rendered video URL and advance the workflow to publish approval.
    """

    body = await request.body()

    # Security Layer 1: Signature verification (Remotion uses HMAC SHA-512)
    signature_header = _get_first_header(
        request,
        ["webhook-signature", "webhook_signature", "X-Remotion-Signature"],
    )

    remotion_mode = effective_remotion_provider(settings)

    # In real mode, Remotion must have a secret configured and a signature header.
    if remotion_mode == "real" and not settings.remotion_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="REMOTION_WEBHOOK_SECRET must be configured for webhook verification.",
        )

    if signature_header and settings.remotion_webhook_secret:
        if not _verify_webhook_signature(
            payload=body,
            signature=signature_header,
            secret=settings.remotion_webhook_secret,
            source="remotion",
            header_name="X-Remotion-Signature",
            algorithm="sha512",  # Remotion uses SHA-512
        ):
            logger.warning(
                "Remotion webhook signature verification failed",
                run_id=request.query_params.get("run_id"),
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid webhook signature",
            )
        logger.info("Remotion webhook signature verified")
    elif settings.remotion_webhook_secret and remotion_mode == "real":
        # Secret configured but no signature - fail closed
        logger.error(
            "Remotion webhook missing signature header",
            headers=dict(request.headers),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing webhook signature",
        )

    run_id_raw = request.query_params.get("run_id")
    if not run_id_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing run_id query parameter",
        )
    run_id = _parse_run_id(run_id_raw)

    # Security Layer 2: Run ID validation
    # Verify run exists and is in correct status
    run = await run_repo.get_async(run_id)
    if not run:
        logger.warning(
            "Remotion webhook for non-existent run",
            run_id=str(run_id),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found",
        )

    skip_status_checks = settings.disable_background_workflows or remotion_mode != "real"

    if not skip_status_checks and run.status != RunStatus.AWAITING_RENDER.value:
        logger.warning(
            "Remotion webhook for run in wrong status",
            run_id=str(run_id),
            current_status=run.status,
            expected_status=RunStatus.AWAITING_RENDER.value,
        )
        # Allow if already completed (idempotency), reject otherwise
        if run.status not in (RunStatus.COMPLETED.value, RunStatus.AWAITING_PUBLISH_APPROVAL.value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Run {run_id} is in status {run.status}, expected {RunStatus.AWAITING_RENDER.value}",
            )

    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")

    status_value = payload.get("status") or payload.get("state")
    output_url = payload.get("output_url") or payload.get("url")
    job_id = payload.get("job_id") or payload.get("id")
    error = payload.get("error")

    # Fast path for tests: acknowledge without DB side effects
    if settings.disable_background_workflows:
        if status_value == "error" or error:
            return RemotionWebhookResponse(status="error", run_id=str(run_id), error=error)
        if not output_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No output_url in payload",
            )
        # Best-effort persist artifact/status so tests can verify
        try:
            from myloware.storage.database import get_async_session_factory

            SessionLocal = get_async_session_factory()
            async with SessionLocal() as session:
                run_repo = RunRepository(session)
                await run_repo.add_artifact_async(run_id, "video", output_url)
                await run_repo.update_async(
                    run_id, status=RunStatus.AWAITING_PUBLISH_APPROVAL.value
                )
                await session.commit()
        except Exception as exc:  # pragma: no cover - diagnostic only
            logger.warning("Fake Remotion webhook could not persist artifact: %s", exc)
        return RemotionWebhookResponse(status="accepted", run_id=str(run_id), output_url=output_url)

    # Security Layer 3: Job ID validation (skip in fake/background-disabled mode)
    if job_id and not skip_status_checks:
        existing_artifacts = await artifact_repo.get_by_run_async(run_id)
        job_id_found = False
        for artifact in existing_artifacts:
            if (
                artifact.artifact_type == ArtifactType.EDITOR_OUTPUT.value
                and artifact.artifact_metadata
                and artifact.artifact_metadata.get("render_job_id") == job_id
            ):
                job_id_found = True
                break

        if not job_id_found:
            logger.warning(
                "Remotion webhook for unknown job_id",
                run_id=str(run_id),
                job_id=job_id,
            )
            # Reject unknown jobs unless explicitly in test mode.
            if not settings.disable_background_workflows:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unknown job_id: {job_id}. This job was not submitted by us.",
                )
        else:
            logger.info(
                "Remotion webhook job_id validated",
                run_id=str(run_id),
                job_id=job_id,
            )

    # Security Layer 4: Idempotency check
    # Check if we've already processed this job_id for this run
    if job_id:
        existing_artifacts = await artifact_repo.get_by_run_async(run_id)
        for artifact in existing_artifacts:
            if (
                artifact.artifact_type == ArtifactType.RENDERED_VIDEO.value
                and artifact.artifact_metadata
                and artifact.artifact_metadata.get("render_job_id") == job_id
            ):
                logger.info(
                    "Remotion webhook already processed (idempotency)",
                    run_id=str(run_id),
                    job_id=job_id,
                )
                return RemotionWebhookResponse(
                    status="accepted",
                    run_id=str(run_id),
                    output_url=artifact.uri,
                ).model_dump()

    logger.info(
        "Remotion webhook received",
        extra={
            "run_id": str(run_id),
            "job_id": job_id,
            "status": status_value,
            "output_url": output_url,
        },
    )

    # Scale mode: enqueue webhook processing to workers and ACK immediately.
    if settings.workflow_dispatcher == "db":
        job_repo = JobRepository(run_repo.session)
        idem = idempotency_remotion_webhook(run_id, str(job_id) if job_id else None)
        if not idem:
            idem = f"remotion:{run_id}:hash:{hashlib.sha256(body).hexdigest()}"
        try:
            await job_repo.enqueue_async(
                JOB_WEBHOOK_REMOTION,
                run_id=run_id,
                payload={
                    "status": status_value,
                    "error": error,
                    "job_id": job_id,
                    "output_url": output_url,
                },
                idempotency_key=idem,
                max_attempts=settings.job_max_attempts,
            )
            await run_repo.session.commit()
        except ValueError:
            await run_repo.session.rollback()
        return RemotionWebhookResponse(
            status="accepted",
            run_id=str(run_id),
            output_url=output_url,
        ).model_dump()

    if status_value == "error" or error:
        await run_repo.update_async(
            run_id, status=RunStatus.FAILED.value, error=error or "Render failed"
        )
        await run_repo.session.commit()
        return RemotionWebhookResponse(status="error", run_id=str(run_id), error=error)

    if status_value not in ("done", "completed", "ready"):
        return RemotionWebhookResponse(status=status_value or "pending", run_id=str(run_id))

    if not output_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No output_url in payload",
        )

    output_url = normalize_remotion_output_url(output_url)

    await artifact_repo.create_async(
        run_id=run_id,
        persona="editor",
        artifact_type=ArtifactType.RENDERED_VIDEO,
        uri=output_url,
        metadata={
            "render_job_id": job_id,  # Store for idempotency check
            "job_id": job_id,  # Legacy field
            "status": status_value,
            "source": "remotion",
            "processed_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await run_repo.session.commit()

    # Resume LangGraph workflow.
    background_tasks.add_task(_resume_langgraph_after_render, run_id, output_url)

    return RemotionWebhookResponse(status="accepted", run_id=str(run_id), output_url=output_url)


__all__ = ["router", "sora_webhook", "remotion_webhook"]
