from __future__ import annotations

from collections.abc import Mapping
from typing import Any
import json
import uuid
import logging

from ...metrics import webhook_verify_total
from .state_updates import (
    _coerce_result_dict,
    hydrate_video_spec_impl,
    mark_video_generated_impl,
)


webhook_logger = logging.getLogger("myloware.api.webhooks")


def handle_kieai_event_impl(
    service: Any,
    *,
    headers: Mapping[str, str],
    payload: bytes,
    run_id: str | None,
    logger: Any,
) -> dict[str, Any]:
    request_id = headers.get("x-request-id") or str(uuid.uuid4())
    signature: str | None = None
    for header_name in ("x-signature", "x-kie-signature", "x-webhook-signature"):
        if header_name in headers:
            signature = headers.get(header_name)
            break
    normalized_signature = signature.strip() if isinstance(signature, str) else signature
    has_signature = bool(normalized_signature)
    verified = has_signature and service._kieai.verify_signature(payload, normalized_signature)
    signature_status = "verified" if verified else ("missing" if signature is None else "rejected")
    webhook_verify_total.labels(provider="kieai", status=signature_status).inc()
    try:
        stored = service._db.record_webhook_event(
            idempotency_key=request_id,
            provider="kieai",
            headers=headers,
            payload=payload,
            signature_status=signature_status,
        )
    except Exception as exc:  # pragma: no cover - storage failures go to DLQ
        logger.error(
            "Failed to persist kie.ai webhook event; sending to DLQ",
            extra={"request_id": request_id, "error": str(exc)},
        )
        try:
            service._db.record_webhook_dlq(
                idempotency_key=request_id,
                provider="kieai",
                headers=headers,
                payload=payload,
                error=str(exc),
            )
        except Exception:
            logger.warning(
                "Failed to record kie.ai DLQ entry after storage error",
                extra={"request_id": request_id},
            )
        return {"status": "dlq"}

    if not stored:
        return {"status": "duplicate"}
    if not verified:
        logger.warning(
            "Invalid or missing kie.ai signature (accepting anyway - third-party provider)",
            extra={"request_id": request_id, "signature_status": signature_status},
        )

    try:
        event = json.loads(payload.decode("utf-8")) if payload else {}
        data = event.get("data") or {}
        metadata = event.get("metadata") or {}
        run_id = (
            run_id
            or metadata.get("runId")
            or data.get("runId")
            or data.get("metadata", {}).get("runId")
        )
        if not run_id:
            return {"status": "missing runId"}
        state = (data.get("state") or "").lower()
        # Accept either explicit success/completed or presence of resultUrls in info block
        info = data.get("info") or {}
        candidate_urls = info.get("resultUrls") or info.get("result_urls") or []
        # Detect provider-reported failure early and persist as error
        if state in {"failed", "error", "canceled", "cancelled"} or isinstance(
            data.get("error"),
            (dict, str),
        ):
            error_meta: dict[str, Any] = {
                "state": state,
                "error": data.get("error") or info.get("error") or event.get("error"),
                "taskId": data.get("taskId") or (data.get("response", {}) or {}).get("taskId"),
            }
            service._db.create_artifact(
                run_id=run_id,
                artifact_type="kieai.error",
                url=None,
                provider="kieai",
                checksum=None,
                metadata=error_meta,
            )
            service._db.update_run(
                run_id=run_id,
                status="error",
                result={"error": error_meta},
            )
            return {"status": "error", "run_id": run_id}
        if state not in {"success", "completed"} and not (
            isinstance(candidate_urls, list) and candidate_urls
        ):
            logger.info("Kie.ai task not yet complete", extra={"run_id": run_id, "state": state})
            return {"status": "accepted"}
        video_index = (
            metadata.get("videoIndex")
            or data.get("videoIndex")
            or data.get("metadata", {}).get("videoIndex")
        )
        subject = metadata.get("subject") or data.get("subject") or data.get("metadata", {}).get(
            "subject",
        )
        header = metadata.get("header") or data.get("header") or data.get("metadata", {}).get(
            "header",
        )
        task_id = data.get("taskId") or (data.get("response", {}) or {}).get("taskId")
        if video_index is None and task_id:
            # Try to infer index by matching taskId against recorded artifacts
            try:
                for art in service._db.list_artifacts(run_id):
                    if art.get("type") == "kieai.job":
                        meta = art.get("metadata") or {}
                        recorded_task = (
                            (meta.get("data") or {}).get("taskId")
                        ) or meta.get("taskId") or meta.get("jobId")
                        if recorded_task == task_id:
                            video_index = meta.get("videoIndex")
                            subject = subject or meta.get("subject")
                            header = header or meta.get("header")
                            break
            except Exception as exc:  # pragma: no cover - best-effort logging
                logger.warning(
                    "Failed to correlate kie.ai task id",
                    extra={"run_id": run_id, "task_id": task_id or "unknown", "error": str(exc)},
                )
        if video_index is None:
            # Fallback: assume first pending slot
            run_record = service._db.get_run(run_id)
            result = _coerce_result_dict(run_record.get("result")) if run_record else {}
            videos = result.get("videos") or []
            for item in videos:
                if item.get("status") != "published":
                    video_index = item.get("index")
                    break
        if video_index is None:
            logger.warning("Unable to determine video index for kie.ai event", extra={"run_id": run_id})
            return {"status": "missing-video-index"}
        video_index = int(video_index)
        asset_url = (
            data.get("videoUrl")
            or data.get("video_url")
            or (candidate_urls[0] if isinstance(candidate_urls, list) and candidate_urls else None)
            or data.get("result", {}).get("assetUrl")
            or metadata.get("videoUrl")
        )
        prompt = data.get("prompt") or event.get("prompt") or ""
        enriched_video = hydrate_video_spec_impl(
            service,
            run_id=run_id,
            video={
                "index": video_index,
                "subject": subject,
                "header": header,
            },
        )
        if asset_url:
            service._db.create_artifact(
                run_id=run_id,
                artifact_type="kieai.clip",
                url=asset_url,
                provider="kieai",
                checksum=None,
                metadata={
                    "videoIndex": video_index,
                    "subject": enriched_video.get("subject"),
                    "header": enriched_video.get("header"),
                },
            )

        mark_video_generated_impl(
            service,
            run_id=run_id,
            video=enriched_video,
            asset_url=asset_url,
            prompt=prompt,
        )

        return {
            "status": "generated",
            "run_id": run_id,
            "video_index": video_index,
        }
    except Exception as exc:  # pragma: no cover - unexpected processing errors go to DLQ
        logger.error(
            "Kie.ai webhook processing failed; sending to DLQ",
            extra={"run_id": run_id, "request_id": request_id, "error": str(exc)},
        )
        try:
            service._db.record_webhook_dlq(
                idempotency_key=request_id,
                provider="kieai",
                headers=headers,
                payload=payload,
                error=str(exc),
            )
        except Exception:
            logger.warning(
                "Failed to record kie.ai DLQ entry after processing error",
                extra={"request_id": request_id},
            )
        return {"status": "dlq"}


def handle_upload_post_webhook_impl(
    service: Any,
    *,
    headers: Mapping[str, str],
    payload: bytes,
) -> dict[str, Any]:
    request_id = headers.get("x-request-id") or str(uuid.uuid4())
    signature = headers.get("x-signature")
    normalized_signature = signature.strip() if isinstance(signature, str) else signature
    has_signature = bool(normalized_signature)
    verified = has_signature and service._upload_post.verify_signature(payload, normalized_signature)
    signature_status = "verified" if verified else ("missing" if signature is None else "rejected")
    webhook_verify_total.labels(provider="upload-post", status=signature_status).inc()
    try:
        stored = service._db.record_webhook_event(
            idempotency_key=request_id,
            provider="upload-post",
            headers=headers,
            payload=payload,
            signature_status=signature_status,
        )
    except Exception as exc:  # pragma: no cover - storage failures go to DLQ
        webhook_logger.warning(
            "Failed to persist upload-post webhook event; sending to DLQ",
            extra={"request_id": request_id, "error": str(exc)},
        )
        try:
            service._db.record_webhook_dlq(
                idempotency_key=request_id,
                provider="upload-post",
                headers=headers,
                payload=payload,
                error=str(exc),
            )
        except Exception:
            webhook_logger.warning(
                "Failed to record upload-post DLQ entry after storage error",
                extra={"request_id": request_id},
            )
        return {"status": "dlq"}

    status = "duplicate" if not stored else ("accepted" if verified else "invalid")
    return {"status": status}
