"""External service webhook handlers.

These endpoints receive callbacks from external services (KIE.ai, Remotion)
when async operations complete. They update run status and trigger the next
workflow step.

Flow:
1. Producer submits to KIE.ai → Run status = AWAITING_VIDEO_GENERATION
2. KIE.ai webhook (this file) → Store clips → When all ready, trigger Editor
3. Editor submits to Remotion → Run status = AWAITING_RENDER
4. Remotion webhook (this file) → Store video → Trigger publish approval
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from config.settings import settings
from storage.database import get_session
from storage.models import ArtifactType, RunStatus
from storage.repositories import ArtifactRepository, RunRepository

logger = logging.getLogger("api.webhooks")


async def _transcode_video(source_url: str, run_id: UUID, video_index: int) -> str | None:
    """Download and transcode KIE.ai video to Remotion-compatible format.
    
    KIE.ai videos often have codec issues that Chromium/Remotion can't decode.
    This transcodes to H.264/AAC which works reliably.
    
    Returns the new video URL (served via our media endpoint) or None if failed.
    """
    import subprocess
    import tempfile
    import httpx
    import os
    
    output_filename = f"kie_{run_id}_{video_index}.mp4"
    output_dir = "/tmp/myloware_videos"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, output_filename)
    
    try:
        # Download video
        logger.info("Downloading video for transcode: %s", source_url[:60])
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(source_url)
            response.raise_for_status()
            
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(response.content)
                input_path = tmp.name
        
        # Transcode with ffmpeg (via docker if not installed locally)
        logger.info("Transcoding video to H.264/AAC...")
        
        # Try local ffmpeg first, fall back to docker
        ffmpeg_cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            output_path
        ]
        
        result = subprocess.run(ffmpeg_cmd, capture_output=True, timeout=300)
        
        if result.returncode != 0:
            # Try docker ffmpeg
            logger.info("Local ffmpeg failed, trying docker...")
            docker_cmd = [
                "docker", "run", "--rm",
                "-v", f"{os.path.dirname(input_path)}:/input",
                "-v", f"{output_dir}:/output",
                "linuxserver/ffmpeg",
                "-y", "-i", f"/input/{os.path.basename(input_path)}",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                f"/output/{output_filename}"
            ]
            result = subprocess.run(docker_cmd, capture_output=True, timeout=300)
            
            if result.returncode != 0:
                logger.error("Transcode failed: %s", result.stderr.decode()[:200])
                return None
        
        # Clean up input
        os.unlink(input_path)
        
        # Return URL via our media endpoint
        transcoded_url = f"{settings.webhook_base_url}/v1/media/transcoded/{output_filename}"
        logger.info("Transcoded video available at: %s", transcoded_url)
        return transcoded_url
        
    except Exception as e:
        logger.error("Transcode error: %s", e)
        return None

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])


def _verify_webhook_signature(
    payload: bytes,
    signature: Optional[str],
    secret: str,
    header_name: str = "X-Signature",
) -> bool:
    """Verify webhook signature using HMAC-SHA256.
    
    Args:
        payload: Raw request body bytes
        signature: Signature from request header
        secret: Shared secret for HMAC
        header_name: Name of the signature header (for logging)
        
    Returns:
        True if signature is valid or if no secret is configured (dev mode)
    """
    # If no secret is configured, skip verification (dev mode)
    if not secret:
        logger.debug("Webhook signature verification skipped - no secret configured")
        return True
    
    if not signature:
        logger.warning("Missing webhook signature header: %s", header_name)
        return False
    
    # Remove any prefix like "sha256=" if present
    if signature.startswith("sha256="):
        signature = signature[7:]
    
    expected = hmac.new(
        secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()
    
    if hmac.compare_digest(expected, signature):
        return True
    
    logger.warning("Invalid webhook signature")
    return False


def _parse_run_id(raw: Any) -> UUID:
    """Parse and validate run_id from webhook payload."""
    try:
        return UUID(str(raw))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid run_id"
        ) from exc


def _lookup_task_metadata(
    artifact_repo: ArtifactRepository,
    run_id: UUID,
    task_id: str,
) -> Dict[str, Any] | None:
    """Look up cache metadata for a task_id from stored mapping.
    
    The KIE tool stores task_id -> metadata mapping in a CLIP_MANIFEST artifact
    since KIE.ai doesn't return custom metadata in callbacks.
    """
    import json
    
    try:
        artifacts = artifact_repo.get_by_run(run_id)
        for artifact in artifacts:
            if (artifact.artifact_type == ArtifactType.CLIP_MANIFEST.value and
                artifact.artifact_metadata and
                artifact.artifact_metadata.get("type") == "task_metadata_mapping"):
                
                task_mapping = json.loads(artifact.content or "{}")
                if task_id in task_mapping:
                    return task_mapping[task_id]
        return None
    except Exception as e:
        logger.warning("Failed to lookup task metadata: %s", e)
        return None


def _parse_video_urls(data: Dict[str, Any]) -> list[str]:
    """Extract video URLs from KIE.ai callback data."""
    # KIE returns resultUrls as JSON string
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
        data.get("videoUrl")
        or data.get("video_url")
        or data.get("info", {}).get("videoUrl")
    )
    return [video_url] if video_url else []


async def _continue_workflow_after_videos(run_id: UUID):
    """Continue workflow after all video clips are ready."""
    # Import here to avoid circular imports
    from workflows.orchestrator import continue_after_producer
    
    logger.info("Continuing workflow after video generation: %s", run_id)
    try:
        await continue_after_producer(run_id)
    except Exception as exc:
        logger.error("Failed to continue workflow: %s", exc, exc_info=True)
        with get_session() as session:
            run_repo = RunRepository(session)
            run_repo.update(run_id, status=RunStatus.FAILED.value, error=str(exc))
            session.commit()  # Ensure error status is persisted


async def _continue_workflow_after_render(run_id: UUID, video_url: str | None = None):
    """Continue workflow after video is rendered."""
    # Update status and store video URL in artifacts for publisher
    logger.info("Render complete, awaiting publish approval: %s", run_id)
    with get_session() as session:
        run_repo = RunRepository(session)
        artifact_repo = ArtifactRepository(session)
        
        # If video_url not provided, look it up from artifacts
        # Get the LATEST rendered_video artifact that has a URI
        if not video_url:
            artifacts = artifact_repo.get_by_run(run_id)
            rendered_artifacts = [
                a for a in artifacts 
                if a.artifact_type == ArtifactType.RENDERED_VIDEO.value and a.uri
            ]
            # Get the most recent one (artifacts are ordered by created_at)
            rendered = rendered_artifacts[-1] if rendered_artifacts else None
            video_url = rendered.uri if rendered else None
        
        # Store video URL in run artifacts for publisher to use
        if video_url:
            run_repo.add_artifact(run_id, "video", video_url)
        
        run_repo.update(run_id, status=RunStatus.AWAITING_PUBLISH_APPROVAL.value)
        session.commit()  # Persist the status change


@router.post("/kieai")
async def kieai_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    """Handle KIE.ai video generation completion callbacks.
    
    KIE.ai sends a callback for each video clip when it's ready.
    Once all expected clips are received, we trigger the Editor step.
    """
    # Verify webhook signature if configured
    body = await request.body()
    signature = request.headers.get("X-Signature") or request.headers.get("X-KIE-Signature")
    if not _verify_webhook_signature(body, signature, settings.kie_signing_secret, "X-KIE-Signature"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )
    
    # Parse run_id from query params (we include it in the callback URL)
    run_id_raw = request.query_params.get("run_id")
    if not run_id_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing run_id query parameter",
        )
    run_id = _parse_run_id(run_id_raw)
    
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON"
        )

    # LOG THE RAW PAYLOAD - we need to align to whatever KIE.ai sends
    logger.info("KIE webhook RAW payload: %s", json.dumps(payload, indent=2, default=str))

    # Extract data from KIE.ai callback format
    # KIE.ai format: {"code": 200, "data": {"info": {"resultUrls": [...]}, "taskId": "..."}, "msg": "..."}
    code = payload.get("code")
    status_msg = payload.get("msg", "")  # renamed from 'msg' to avoid LogRecord conflict
    data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
    info = data.get("info", {}) if isinstance(data.get("info"), dict) else {}
    metadata = data.get("metadata") or payload.get("metadata") or {}
    
    task_id = data.get("taskId") or payload.get("taskId")
    video_index = metadata.get("videoIndex", 0)
    
    # Get video URLs from data.info.resultUrls (KIE.ai's actual format)
    video_urls = info.get("resultUrls") or info.get("result_urls") or []
    if isinstance(video_urls, str):
        try:
            video_urls = json.loads(video_urls)
        except json.JSONDecodeError:
            video_urls = [video_urls] if video_urls else []
    
    logger.info(
        "KIE webhook parsed",
        extra={
            "run_id": str(run_id),
            "task_id": task_id,
            "code": code,
            "status_msg": status_msg,
            "has_video_urls": len(video_urls) > 0,
            "video_index": video_index,
        },
    )
    
    # Check for failure
    if code != 200:
        error_msg = status_msg or "Video generation failed"
        logger.error("KIE video generation failed: %s", error_msg)
        with get_session() as session:
            run_repo = RunRepository(session)
            run_repo.update(
                run_id,
                status=RunStatus.FAILED.value,
                error=f"KIE.ai error: {error_msg}",
            )
        return {"status": "error", "run_id": str(run_id), "error": error_msg}
    
    # If no video URLs, it's a progress callback (not completion)
    if not video_urls:
        logger.info("KIE progress callback (no video URLs yet): %s", task_id)
        return {"status": "pending", "run_id": str(run_id), "task_id": task_id}
    
    # We have video URLs - this is a completion callback!
    logger.info("KIE completion callback with %d URLs: %s", len(video_urls), video_urls)
    original_url = video_urls[0]
    
    # Transcode video to Remotion-compatible format (H.264/AAC)
    # KIE.ai videos often have codec issues that Chromium can't decode
    transcoded_url = await _transcode_video(original_url, run_id, video_index)
    video_url = transcoded_url if transcoded_url else original_url
    
    if transcoded_url:
        logger.info("Using transcoded video: %s", transcoded_url)
    else:
        logger.warning("Transcode failed, using original URL (may cause render issues)")
    
    with get_session() as session:
        artifact_repo = ArtifactRepository(session)
        run_repo = RunRepository(session)
        
        # Build artifact metadata including cache info
        artifact_metadata = {
            "task_id": task_id,
            "video_index": video_index,
            "source": "kieai",
        }
        
        # First try to get cache metadata from KIE.ai callback
        if metadata.get("topic"):
            artifact_metadata["topic"] = metadata["topic"]
        if metadata.get("sign"):
            artifact_metadata["sign"] = metadata["sign"]
        if metadata.get("object_name"):
            artifact_metadata["object_name"] = metadata["object_name"]
        
        # If no cache metadata in callback, look up from stored task_metadata mapping
        if not artifact_metadata.get("topic") and task_id:
            cache_meta = _lookup_task_metadata(artifact_repo, run_id, task_id)
            if cache_meta:
                artifact_metadata.update(cache_meta)
                logger.info("Retrieved cache metadata for task %s from stored mapping", task_id)
        
        # Store the video clip artifact (with cache metadata for reuse)
        artifact_repo.create(
            run_id=run_id,
            persona="producer",
            artifact_type=ArtifactType.VIDEO_CLIP,
            uri=video_url,
            metadata=artifact_metadata,
        )
        
        # Get the run with lock to prevent race conditions from concurrent webhooks
        run = run_repo.get_for_update(run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Run not found"
            )
        
        # Count how many clips we have vs how many we expect
        all_artifacts = artifact_repo.get_by_run(run_id)
        clip_count = sum(
            1 for a in all_artifacts
            if a.artifact_type == ArtifactType.VIDEO_CLIP.value
        )
        
        # Get expected count from the clip manifest
        manifest = next(
            (a for a in all_artifacts if a.artifact_type == ArtifactType.CLIP_MANIFEST.value),
            None,
        )
        expected_count = 1  # Default
        if manifest and manifest.artifact_metadata:
            expected_count = manifest.artifact_metadata.get("task_count", 1)
        
        logger.info(
            "Video clip %d/%d received for run %s",
            clip_count,
            expected_count,
            run_id,
        )
        
        # If all clips are ready AND we haven't already moved past this stage, continue
        if clip_count >= expected_count:
            # Idempotency: only trigger Editor if still awaiting video generation
            if run.status == RunStatus.AWAITING_VIDEO_GENERATION.value:
                logger.info("All %d clips ready, triggering Editor", expected_count)
                # Update status immediately to prevent duplicate triggers
                run_repo.update(run_id, status=RunStatus.AWAITING_RENDER.value)
                background_tasks.add_task(_continue_workflow_after_videos, run_id)
            else:
                logger.info("Ignoring duplicate webhook - run already at status %s", run.status)
    
    return {
        "status": "accepted",
        "run_id": str(run_id),
        "video_index": video_index,
        "video_url": video_url,
    }


@router.post("/remotion")
async def remotion_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    """Handle Remotion render completion callbacks.
    
    Remotion service sends a callback when a render job completes. We persist the
    rendered video URL and advance the workflow to publish approval.
    """

    body = await request.body()
    signature = request.headers.get("x-remotion-signature") or request.headers.get("X-Remotion-Signature")
    if not _verify_webhook_signature(
        body,
        signature,
        settings.remotion_webhook_secret,
        "X-Remotion-Signature",
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )

    run_id_raw = request.query_params.get("run_id")
    if not run_id_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing run_id query parameter",
        )
    run_id = _parse_run_id(run_id_raw)

    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON"
        )

    status_value = payload.get("status") or payload.get("state")
    output_url = payload.get("output_url") or payload.get("url")
    job_id = payload.get("job_id") or payload.get("id")
    error = payload.get("error")

    logger.info(
        "Remotion webhook received",
        extra={
            "run_id": str(run_id),
            "job_id": job_id,
            "status": status_value,
            "output_url": output_url,
        },
    )

    if status_value == "error" or error:
        with get_session() as session:
            run_repo = RunRepository(session)
            run_repo.update(run_id, status=RunStatus.FAILED.value, error=error or "Render failed")
            session.commit()
        return {"status": "error", "run_id": str(run_id), "error": error}

    if status_value not in ("done", "completed", "ready"):
        return {"status": status_value or "pending", "run_id": str(run_id)}

    if not output_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No output_url in payload",
        )

    # Convert localhost Remotion URL to public proxy URL
    # This allows external services (like Upload-Post) to access the video
    if output_url and ("localhost:3001" in output_url or "remotion-service:3001" in output_url):
        video_id = output_url.split("/")[-1].replace(".mp4", "")
        public_url = f"{settings.webhook_base_url}/v1/media/video/{video_id}"
        logger.info("Converted localhost URL to public: %s -> %s", output_url, public_url)
        output_url = public_url

    with get_session() as session:
        artifact_repo = ArtifactRepository(session)

        artifact_repo.create(
            run_id=run_id,
            persona="editor",
            artifact_type=ArtifactType.RENDERED_VIDEO,
            uri=output_url,
            metadata={
                "job_id": job_id,
                "status": status_value,
                "source": "remotion",
            },
        )

    background_tasks.add_task(_continue_workflow_after_render, run_id, output_url)

    return {
        "status": "accepted",
        "run_id": str(run_id),
        "job_id": job_id,
        "output_url": output_url,
    }


__all__ = ["router", "kieai_webhook", "remotion_webhook"]
