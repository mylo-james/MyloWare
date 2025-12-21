"""Public demo endpoints (motivational-only)."""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from sqlalchemy.exc import IntegrityError
import httpx

from myloware.api.dependencies import get_async_llama_client, get_vector_db_id
from myloware.api.dependencies_async import get_async_artifact_repo, get_async_run_repo
from myloware.api.rate_limit import key_api_key_or_ip
from myloware.api.schemas import ErrorResponse
from myloware.config import settings
from myloware.config.provider_modes import effective_remotion_provider
from myloware.llama_clients import get_sync_client
from myloware.observability.logging import get_logger
from myloware.safety import check_brief_safety
from myloware.storage.models import ArtifactType, RunStatus
from myloware.storage.repositories import ArtifactRepository, JobRepository, RunRepository
from myloware.workers.job_types import JOB_RUN_EXECUTE, idempotency_run_execute
from myloware.workflows.langgraph.hitl import resume_hitl_gate
from myloware.workflows.langgraph.workflow import run_workflow_async

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/public/demo", tags=["public-demo"])
limiter = Limiter(key_func=key_api_key_or_ip)

_SAFE_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class PublicDemoStartRequest(BaseModel):
    """Request to start a public demo run."""

    brief: str = Field(..., max_length=4000, description="Motivational video brief")
    name: Optional[str] = Field(default=None, max_length=80, description="Optional name")


class PublicDemoStartResponse(BaseModel):
    public_token: str
    status: str
    message: str


class PublicDemoActivityEvent(BaseModel):
    at: str
    type: str
    message: str


class PublicDemoRunResponse(BaseModel):
    status: str
    current_step: Optional[str] = None
    gate: Optional[str] = None
    brief: Optional[str] = None
    created_at: Optional[str] = None
    published_url: Optional[str] = None
    rendered_video_url: Optional[str] = None
    render_job_id: Optional[str] = None
    render_status: Optional[str] = None
    render_progress_percent: Optional[int] = None
    ideas_markdown: Optional[str] = None
    clip_count: Optional[int] = None
    expected_clip_count: Optional[int] = None
    video_progress_percent: Optional[int] = None
    error: Optional[str] = None
    activity: list[PublicDemoActivityEvent] = Field(default_factory=list)
    updated_at: Optional[str] = None


class PublicDemoGateRequest(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=240, description="Optional comment")


def _require_public_demo_enabled() -> None:
    if not settings.public_demo_enabled:
        raise HTTPException(status_code=404, detail="Public demo is disabled")


def _ensure_workflow_allowed(workflow: str) -> None:
    allowed = {w.strip().lower() for w in settings.public_demo_allowed_workflows if w}
    if workflow.lower() not in allowed:
        raise HTTPException(status_code=403, detail="Workflow not available for public demo")


def _generate_public_token() -> str:
    return secrets.token_urlsafe(24)


def _gate_from_status(status: str | None) -> str | None:
    if status == RunStatus.AWAITING_IDEATION_APPROVAL.value:
        return "ideation"
    if status == RunStatus.AWAITING_PUBLISH_APPROVAL.value:
        return "publish"
    return None


async def _build_public_demo_response(
    run: Any,
    artifact_repo: ArtifactRepository,
) -> PublicDemoRunResponse:
    max_preview_chars = 18_000

    published_url = None
    published_artifact = await artifact_repo.get_latest_artifact_by_type_async(
        run.id, ArtifactType.PUBLISHED_URL
    )
    if published_artifact and published_artifact.uri:
        published_url = published_artifact.uri

    rendered_video_url = None
    rendered_artifact = await artifact_repo.get_latest_artifact_by_type_async(
        run.id, ArtifactType.RENDERED_VIDEO
    )
    if rendered_artifact and rendered_artifact.uri:
        public_token = getattr(run, "public_token", None)
        if getattr(run, "public_demo", False) and isinstance(public_token, str) and public_token:
            rendered_video_url = f"/v1/public/demo/runs/{public_token}/rendered_video"
        else:
            rendered_video_url = rendered_artifact.uri

    ideas_markdown = None
    ideas_artifact = await artifact_repo.get_latest_artifact_by_type_async(
        run.id, ArtifactType.IDEAS
    )
    if ideas_artifact and ideas_artifact.content:
        ideas_markdown = ideas_artifact.content
    else:
        ideas_value = (getattr(run, "artifacts", None) or {}).get("ideas")
        if isinstance(ideas_value, str) and ideas_value:
            ideas_markdown = ideas_value

    if ideas_markdown and len(ideas_markdown) > max_preview_chars:
        ideas_markdown = ideas_markdown[:max_preview_chars].rstrip() + "\n\n…(truncated)…"

    artifacts = await artifact_repo.get_by_run_async(run.id)
    clip_count = sum(
        1
        for art in artifacts
        if getattr(art, "artifact_type", None) == ArtifactType.VIDEO_CLIP.value
        and getattr(art, "uri", None)
    )

    expected_clip_count: int | None = None
    for artifact in reversed(artifacts):
        if getattr(artifact, "artifact_type", None) != ArtifactType.CLIP_MANIFEST.value:
            continue
        meta = getattr(artifact, "artifact_metadata", None) or {}
        if meta.get("type") != "task_metadata_mapping":
            continue
        raw = meta.get("task_count")
        try:
            expected_clip_count = int(raw) if raw is not None else None
        except Exception:
            expected_clip_count = None
        if expected_clip_count is not None:
            break

    if expected_clip_count is None:
        pending_ids = (getattr(run, "artifacts", None) or {}).get("pending_task_ids")
        if isinstance(pending_ids, list) and pending_ids:
            expected_clip_count = len(pending_ids)

    progress_percent: int | None = None
    sora_progress = (getattr(run, "artifacts", None) or {}).get("sora_progress")
    if isinstance(sora_progress, dict):
        raw = sora_progress.get("progress_percent")
        try:
            progress_percent = int(raw) if raw is not None else None
        except Exception:
            progress_percent = None

    def _artifact_to_event(artifact: Any) -> PublicDemoActivityEvent | None:
        art_type = getattr(artifact, "artifact_type", None)
        created_at = getattr(artifact, "created_at", None)
        if not art_type or not created_at:
            return None

        meta = getattr(artifact, "artifact_metadata", None) or {}
        video_index = meta.get("video_index")
        task_count = meta.get("task_count")
        render_job_id = meta.get("render_job_id") or meta.get("job_id")

        message = art_type
        if art_type == ArtifactType.IDEAS.value:
            message = "Ideation draft generated"
        elif art_type == ArtifactType.PRODUCER_OUTPUT.value:
            message = "Producer prepared Sora prompts"
        elif art_type == ArtifactType.SORA_REQUEST.value:
            message = f"Sora request queued ({task_count or 'n'} clips)"
        elif art_type == ArtifactType.PUBLISHER_OUTPUT.value:
            message = "Publisher prepared TikTok upload"
        elif art_type == ArtifactType.CLIP_MANIFEST.value:
            message = f"Submitted clip requests ({task_count or 'n'} tasks)"
        elif art_type == ArtifactType.VIDEO_CLIP.value:
            if video_index is not None:
                message = f"Clip ready (#{int(video_index) + 1})"
            else:
                message = "Clip ready"
        elif art_type == ArtifactType.EDITOR_OUTPUT.value:
            message = f"Render started{f' (job {render_job_id})' if render_job_id else ''}"
        elif art_type == ArtifactType.RENDERED_VIDEO.value:
            message = "Render complete"
        elif art_type == ArtifactType.PUBLISHED_URL.value:
            message = "Published to TikTok"
        elif art_type == ArtifactType.REJECTION.value:
            message = "Run rejected"
        elif art_type == ArtifactType.ERROR.value:
            message = "Error recorded"
        elif art_type == ArtifactType.SAFETY_VERDICT.value:
            message = "Safety checks cached"

        return PublicDemoActivityEvent(
            at=created_at.isoformat(),
            type=str(art_type),
            message=message,
        )

    activity: list[PublicDemoActivityEvent] = []
    for artifact in reversed(artifacts):
        event = _artifact_to_event(artifact)
        if event is not None:
            activity.append(event)
        if len(activity) >= 11:
            break
    activity.append(
        PublicDemoActivityEvent(
            at=(
                run.created_at.isoformat()
                if run.created_at
                else datetime.now(timezone.utc).isoformat()
            ),
            type="run",
            message="Run created",
        )
    )

    render_job_id: str | None = None
    for artifact in reversed(artifacts):
        if getattr(artifact, "artifact_type", None) != ArtifactType.EDITOR_OUTPUT.value:
            continue
        meta = getattr(artifact, "artifact_metadata", None) or {}
        job_id = meta.get("render_job_id") or meta.get("job_id")
        if isinstance(job_id, str) and job_id:
            render_job_id = job_id
            break

    render_status: str | None = None
    render_progress_percent: int | None = None
    if (
        render_job_id
        and effective_remotion_provider(settings) == "real"
        and getattr(settings, "remotion_service_url", None)
    ):
        try:
            base_url = str(getattr(settings, "remotion_service_url") or "").rstrip("/")
            if base_url:
                headers: dict[str, str] = {}
                secret = str(getattr(settings, "remotion_api_secret", "") or "").strip()
                if secret:
                    headers = {"Authorization": f"Bearer {secret}", "x-api-key": secret}
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(
                        f"{base_url}/api/render/{render_job_id}",
                        headers=headers or None,
                    )
                if resp.status_code == 200:
                    data = resp.json()
                    status_value = data.get("status")
                    if isinstance(status_value, str) and status_value:
                        render_status = status_value
                    progress_raw = data.get("progress")
                    if progress_raw is not None:
                        try:
                            # Remotion returns 0..1 float; normalize to int percent for UI.
                            render_progress_percent = int(
                                max(0.0, min(1.0, float(progress_raw))) * 100
                            )
                        except Exception:
                            render_progress_percent = None
        except Exception:
            render_status = None
            render_progress_percent = None

    return PublicDemoRunResponse(
        status=run.status,
        current_step=run.current_step,
        gate=_gate_from_status(run.status),
        brief=getattr(run, "input", None),
        created_at=run.created_at.isoformat() if run.created_at else None,
        published_url=published_url,
        rendered_video_url=rendered_video_url,
        render_job_id=render_job_id,
        render_status=render_status,
        render_progress_percent=render_progress_percent,
        ideas_markdown=ideas_markdown,
        clip_count=clip_count,
        expected_clip_count=expected_clip_count,
        video_progress_percent=progress_percent,
        error=getattr(run, "error", None),
        activity=activity,
        updated_at=run.updated_at.isoformat() if run.updated_at else None,
    )


@router.post(
    "/start",
    response_model=PublicDemoStartResponse,
    responses={400: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
@limiter.limit(lambda: settings.public_demo_rate_limit)
async def public_demo_start(
    request: Request,
    body: PublicDemoStartRequest,
    background_tasks: BackgroundTasks,
    run_repo: RunRepository = Depends(get_async_run_repo),
    async_client=Depends(get_async_llama_client),
    vector_db_id: str = Depends(get_vector_db_id),
) -> PublicDemoStartResponse:
    """Start a motivational-only public demo run."""
    _require_public_demo_enabled()

    workflow = "motivational"
    _ensure_workflow_allowed(workflow)

    if settings.enable_safety_shields:
        safety_result = await check_brief_safety(async_client, body.brief)
        if not safety_result.safe:
            logger.warning(
                "Public demo brief rejected by safety shield",
                reason=safety_result.reason,
                category=safety_result.category,
            )
            raise HTTPException(
                status_code=400,
                detail=f"Brief rejected: {safety_result.reason or 'Content policy violation'}",
            )

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=int(settings.public_demo_token_ttl_hours))

    run = None
    public_token: str | None = None
    for _ in range(3):
        public_token = _generate_public_token()
        try:
            run = await run_repo.create_async(
                workflow_name=workflow,
                input=body.brief,
                vector_db_id=vector_db_id,
                public_demo=True,
                public_token=public_token,
                public_expires_at=expires_at.replace(tzinfo=None),
            )
            break
        except IntegrityError:
            await run_repo.session.rollback()
            continue
    if run is None or public_token is None:
        raise HTTPException(status_code=500, detail="Failed to create demo run")

    job_repo = JobRepository(run_repo.session)
    if not settings.disable_background_workflows:
        if settings.workflow_dispatcher == "db":
            try:
                await job_repo.enqueue_async(
                    JOB_RUN_EXECUTE,
                    run_id=run.id,
                    payload={"public_demo": True},
                    idempotency_key=idempotency_run_execute(run.id),
                    max_attempts=settings.job_max_attempts,
                )
            except ValueError:
                pass
        else:
            background_tasks.add_task(
                run_workflow_async,
                client=get_sync_client(),
                run_id=run.id,
                vector_db_id=vector_db_id,
            )

    await run_repo.session.commit()
    logger.info(
        "public_demo_run_started",
        run_id=str(run.id),
        workflow=workflow,
        expires_at=expires_at.isoformat(),
    )

    return PublicDemoStartResponse(
        public_token=public_token,
        status="pending",
        message="Got it — we’re generating your motivational video now.",
    )


@router.get(
    "/runs/{public_token}",
    response_model=PublicDemoRunResponse,
    responses={404: {"model": ErrorResponse}},
)
async def public_demo_status(
    public_token: str,
    run_repo: RunRepository = Depends(get_async_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_async_artifact_repo),
) -> PublicDemoRunResponse:
    _require_public_demo_enabled()

    run = await run_repo.get_by_public_token_async(public_token)
    if run is None or not run.public_demo:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.public_expires_at is not None:
        expires_at = run.public_expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=404, detail="Run not found")

    return await _build_public_demo_response(run, artifact_repo)


@router.post(
    "/runs/{public_token}/approve",
    response_model=PublicDemoRunResponse,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
@limiter.limit(lambda: settings.public_demo_rate_limit)
async def public_demo_approve(
    request: Request,
    public_token: str,
    body: PublicDemoGateRequest,
    run_repo: RunRepository = Depends(get_async_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_async_artifact_repo),
) -> PublicDemoRunResponse:
    _require_public_demo_enabled()

    run = await run_repo.get_by_public_token_async(public_token)
    if run is None or not run.public_demo:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.public_expires_at is not None:
        expires_at = run.public_expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=404, detail="Run not found")

    gate = _gate_from_status(run.status)
    if gate is None:
        raise HTTPException(status_code=400, detail="Run is not awaiting approval")

    try:
        if settings.workflow_dispatcher == "db" and not settings.disable_background_workflows:
            from myloware.workers.job_types import JOB_LANGGRAPH_HITL_RESUME

            job_repo = JobRepository(run_repo.session)
            idem = f"public_demo:{public_token}:{gate}:approve"
            try:
                await job_repo.enqueue_async(
                    JOB_LANGGRAPH_HITL_RESUME,
                    run_id=run.id,
                    payload={"gate": gate, "approved": True, "comment": body.comment},
                    idempotency_key=idem,
                    max_attempts=settings.job_max_attempts,
                )
            except ValueError:
                pass
            await run_repo.session.commit()
        else:
            await resume_hitl_gate(
                run.id,
                gate,
                approved=True,
                comment=body.comment,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await run_repo.session.refresh(run)
    return await _build_public_demo_response(run, artifact_repo)


@router.post(
    "/runs/{public_token}/reject",
    response_model=PublicDemoRunResponse,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
@limiter.limit(lambda: settings.public_demo_rate_limit)
async def public_demo_reject(
    request: Request,
    public_token: str,
    body: PublicDemoGateRequest,
    run_repo: RunRepository = Depends(get_async_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_async_artifact_repo),
) -> PublicDemoRunResponse:
    _require_public_demo_enabled()

    run = await run_repo.get_by_public_token_async(public_token)
    if run is None or not run.public_demo:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.public_expires_at is not None:
        expires_at = run.public_expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=404, detail="Run not found")

    gate = _gate_from_status(run.status)
    if gate is None:
        raise HTTPException(status_code=400, detail="Run is not awaiting approval")

    try:
        if settings.workflow_dispatcher == "db" and not settings.disable_background_workflows:
            from myloware.workers.job_types import JOB_LANGGRAPH_HITL_RESUME

            job_repo = JobRepository(run_repo.session)
            idem = f"public_demo:{public_token}:{gate}:reject"
            try:
                await job_repo.enqueue_async(
                    JOB_LANGGRAPH_HITL_RESUME,
                    run_id=run.id,
                    payload={"gate": gate, "approved": False, "comment": body.comment},
                    idempotency_key=idem,
                    max_attempts=settings.job_max_attempts,
                )
            except ValueError:
                pass
            await run_repo.session.commit()
        else:
            await resume_hitl_gate(
                run.id,
                gate,
                approved=False,
                comment=body.comment,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await run_repo.session.refresh(run)
    return await _build_public_demo_response(run, artifact_repo)


def _extract_video_id_from_rendered_uri(uri: str) -> str | None:
    if not uri:
        return None
    try:
        parsed = urlparse(uri)
    except Exception:
        return None
    path = parsed.path or ""

    match = re.search(r"/v1/media/video/(?P<video_id>[A-Za-z0-9_-]+)$", path)
    if match:
        return match.group("video_id")

    match = re.search(r"/output/(?P<video_id>[A-Za-z0-9_-]+)\.mp4$", path)
    if match:
        return match.group("video_id")

    return None


def _remotion_auth_headers() -> dict[str, str]:
    secret = str(getattr(settings, "remotion_api_secret", "") or "").strip()
    if not secret:
        return {}
    return {"Authorization": f"Bearer {secret}", "X-API-Key": secret}


def _remotion_output_url(video_id: str) -> str:
    base_url = str(getattr(settings, "remotion_service_url", "") or "").rstrip("/")
    if not base_url:
        raise HTTPException(status_code=500, detail="REMOTION_SERVICE_URL not configured")
    return f"{base_url}/output/{video_id}.mp4"


@router.get("/runs/{public_token}/rendered_video")
async def public_demo_rendered_video(
    public_token: str,
    request: Request,
    run_repo: RunRepository = Depends(get_async_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_async_artifact_repo),
) -> StreamingResponse:
    """Stream the rendered video for a public demo run.

    Remotion outputs are typically private. For the public demo, we proxy the video
    through the API using the public run token (instead of exposing MEDIA_ACCESS_TOKEN).
    """
    _require_public_demo_enabled()

    run = await run_repo.get_by_public_token_async(public_token)
    if run is None or not run.public_demo:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.public_expires_at is not None:
        expires_at = run.public_expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=404, detail="Run not found")

    rendered_artifact = await artifact_repo.get_latest_artifact_by_type_async(
        run.id, ArtifactType.RENDERED_VIDEO
    )
    if not rendered_artifact or not rendered_artifact.uri:
        raise HTTPException(status_code=404, detail="Video not found")

    video_id = _extract_video_id_from_rendered_uri(str(rendered_artifact.uri))
    if not video_id or not _SAFE_VIDEO_ID.match(video_id):
        raise HTTPException(status_code=404, detail="Video not found")

    video_url = _remotion_output_url(video_id)
    range_header = request.headers.get("range")

    headers = _remotion_auth_headers()
    if range_header:
        headers["Range"] = range_header
    if not headers:
        headers = None

    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=None))
    stream_cm = client.stream("GET", video_url, headers=headers, follow_redirects=True)
    try:
        upstream = await stream_cm.__aenter__()
        upstream.raise_for_status()

        response_headers: dict[str, str] = {
            "Content-Disposition": f'inline; filename="{video_id}.mp4"',
            "Cache-Control": "private, max-age=0",
        }
        for key in ("content-length", "content-range", "accept-ranges", "etag", "last-modified"):
            if key in upstream.headers:
                response_headers[key.title()] = upstream.headers[key]
        if "Accept-Ranges" not in response_headers:
            response_headers["Accept-Ranges"] = "bytes"

        async def _iter_bytes():
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                try:
                    await stream_cm.__aexit__(None, None, None)
                finally:
                    await client.aclose()

        return StreamingResponse(
            _iter_bytes(),
            status_code=upstream.status_code,
            media_type="video/mp4",
            headers=response_headers,
        )
    except httpx.HTTPStatusError as exc:
        try:
            await stream_cm.__aexit__(type(exc), exc, exc.__traceback__)
        finally:
            await client.aclose()
        raise HTTPException(status_code=404, detail="Video not found") from exc
    except Exception as exc:
        try:
            await stream_cm.__aexit__(type(exc), exc, exc.__traceback__)
        finally:
            await client.aclose()
        logger.exception("Public demo rendered video proxy failed")
        raise HTTPException(status_code=500, detail="Unable to stream video") from exc


__all__ = ["router"]
