"""Media proxy endpoint to serve Remotion output and transcoded videos."""

import re
import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
import httpx

from myloware.config import settings
from myloware.observability.logging import get_logger
from myloware.services.fake_sora import resolve_fake_sora_clip

router = APIRouter(prefix="/v1/media", tags=["media"])
logger = get_logger(__name__)

# Directory for transcoded OpenAI Sora videos
TRANSCODED_DIR = settings.transcode_output_dir

_SAFE_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SAFE_TASK_ID = re.compile(r"^video_[A-Za-z0-9_-]+$")
_SAFE_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def _extract_media_token(request: Request | None) -> str | None:
    if request is None:
        return None
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    return request.headers.get("X-Media-Token")


def _require_media_token(request: Request | None) -> None:
    token = str(getattr(settings, "media_access_token", "") or "").strip()
    if not token:
        return
    provided = _extract_media_token(request)
    if not provided or not secrets.compare_digest(provided, token):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _is_safe_filename(name: str, *, suffix: str | None = None) -> bool:
    if not name or name.strip() != name:
        return False
    if name in {".", ".."}:
        return False
    if "/" in name or "\\" in name:
        return False
    if not _SAFE_FILENAME.match(name):
        return False
    if suffix and not name.endswith(suffix):
        return False
    return True


def _resolve_transcoded_path(filename: str) -> Path:
    if not _is_safe_filename(filename, suffix=".mp4"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    base = Path(TRANSCODED_DIR).resolve()
    candidate = (base / filename).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid filename") from exc
    return candidate


def _transcoded_s3_uri(filename: str) -> str:
    bucket = str(getattr(settings, "transcode_s3_bucket", "") or "").strip()
    if not bucket:
        raise HTTPException(status_code=500, detail="TRANSCODE_S3_BUCKET not configured")

    prefix = str(getattr(settings, "transcode_s3_prefix", "") or "").strip().strip("/")
    key = f"{prefix}/{filename}" if prefix else filename

    from myloware.storage.object_store import build_s3_uri

    return build_s3_uri(bucket=bucket, key=key)


async def _transcoded_presigned_url(filename: str) -> str:
    uri = _transcoded_s3_uri(filename)
    from myloware.storage.object_store import get_s3_store

    store = get_s3_store()
    return await store.presign_get_async(
        uri=uri,
        expires_seconds=int(getattr(settings, "transcode_s3_presign_seconds", 86400) or 86400),
    )


def _validate_task_id(task_id: str) -> None:
    if not _SAFE_TASK_ID.match(task_id):
        raise HTTPException(status_code=400, detail="Invalid task_id")


def _validate_video_id(video_id: str) -> None:
    if not _SAFE_VIDEO_ID.match(video_id):
        raise HTTPException(status_code=400, detail="Invalid video_id")


def _get_video_url(video_id: str) -> str:
    """Build the Remotion video URL."""
    remotion_url = getattr(settings, "remotion_service_url", "http://localhost:3001")
    return f"{remotion_url}/output/{video_id}.mp4"


def _remotion_auth_headers() -> dict[str, str]:
    secret = str(getattr(settings, "remotion_api_secret", "") or "").strip()
    if not secret:
        return {}
    return {"Authorization": f"Bearer {secret}", "X-API-Key": secret}


@router.head("/video/{video_id}")
async def head_video(video_id: str, request: Request) -> Response:
    """HEAD request for video - allows URL validation without downloading."""
    _require_media_token(request)
    _validate_video_id(video_id)
    video_url = _get_video_url(video_id)

    logger.info("HEAD request for video: %s", video_url)

    try:
        async with httpx.AsyncClient() as client:
            # Just check if the video exists and get size
            response = await client.head(
                video_url,
                timeout=30.0,
                follow_redirects=True,
                headers=_remotion_auth_headers() or None,
            )

            if response.status_code == 405:
                # Remotion might not support HEAD, try GET with stream
                response = await client.get(
                    video_url, timeout=30.0, headers=_remotion_auth_headers() or None
                )
                response.raise_for_status()
                content_length = len(response.content)
            else:
                response.raise_for_status()
                content_length = int(response.headers.get("content-length", 0))

            return Response(
                content=b"",
                media_type="video/mp4",
                headers={
                    "Content-Length": str(content_length),
                    "Content-Disposition": f'inline; filename="{video_id}.mp4"',
                    "Accept-Ranges": "bytes",
                },
            )
    except httpx.HTTPStatusError as e:
        logger.error("HEAD failed: %s", e)
        raise HTTPException(status_code=e.response.status_code, detail="Video not found")
    except Exception as e:
        logger.error("Error checking video: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video/{video_id}")
async def get_video(video_id: str, request: Request) -> StreamingResponse:
    """Proxy Remotion rendered videos through the tunnel.

    This allows external services (like Upload-Post) to access
    locally rendered videos via the public tunnel URL.
    """
    _require_media_token(request)
    _validate_video_id(video_id)
    video_url = _get_video_url(video_id)

    logger.info("Proxying video: %s", video_url)

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
            "Cache-Control": "public, max-age=3600",
        }
        # Best-effort propagate size/range headers if upstream supports them.
        for key in ("content-length", "content-range", "accept-ranges", "etag", "last-modified"):
            if key in upstream.headers:
                response_headers[key.title()] = upstream.headers[key]

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
    except httpx.HTTPStatusError as e:
        try:
            await stream_cm.__aexit__(type(e), e, e.__traceback__)
        finally:
            await client.aclose()
        logger.error("Failed to fetch video: %s", e)
        raise HTTPException(status_code=e.response.status_code, detail="Video not found") from e
    except Exception as e:
        try:
            await stream_cm.__aexit__(type(e), e, e.__traceback__)
        finally:
            await client.aclose()
        logger.error("Error proxying video: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.head("/transcoded/{filename}")
async def head_transcoded_video(filename: str, request: Request) -> Response:
    """HEAD request for transcoded OpenAI Sora video."""
    _require_media_token(request)
    if getattr(settings, "transcode_storage_backend", "local") == "s3":
        presigned = await _transcoded_presigned_url(filename)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Some S3-compatible stores do not accept HEAD on presigned GET URLs.
                # Prefer HEAD, fall back to a minimal ranged GET.
                resp = await client.head(presigned, follow_redirects=True)
                if resp.status_code in {403, 405}:
                    resp = await client.get(
                        presigned,
                        follow_redirects=True,
                        headers={"Range": "bytes=0-0"},
                    )
                resp.raise_for_status()

            content_length = int(resp.headers.get("content-length", 0))
            content_range = resp.headers.get("content-range")
            if content_range and "/" in content_range:
                total = content_range.split("/")[-1]
                if total.isdigit():
                    content_length = int(total)
            return Response(
                content=b"",
                media_type="video/mp4",
                headers={
                    "Content-Length": str(content_length),
                    "Content-Disposition": f'inline; filename="{filename}"',
                    "Accept-Ranges": "bytes",
                },
            )
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code, detail="Video not found"
            ) from exc
        except Exception as exc:
            logger.error("Error checking transcoded video: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    filepath = _resolve_transcoded_path(filename)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    file_size = filepath.stat().st_size
    return Response(
        content=b"",
        media_type="video/mp4",
        headers={
            "Content-Length": str(file_size),
            "Content-Disposition": f'inline; filename="{filename}"',
            "Accept-Ranges": "bytes",
        },
    )


@router.get("/transcoded/{filename}")
async def get_transcoded_video(filename: str, request: Request) -> Response:
    """Serve transcoded OpenAI Sora videos.

    OpenAI Sora videos are transcoded to H.264/AAC on webhook receipt
    to ensure compatibility with Remotion's Chromium renderer.
    """
    _require_media_token(request)
    if getattr(settings, "transcode_storage_backend", "local") == "s3":
        presigned = await _transcoded_presigned_url(filename)
        range_header = request.headers.get("range") or request.headers.get("Range")
        headers = {"Range": range_header} if range_header else None

        client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=None))
        stream_cm = client.stream("GET", presigned, headers=headers, follow_redirects=True)
        try:
            upstream = await stream_cm.__aenter__()
            upstream.raise_for_status()

            response_headers: dict[str, str] = {
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "public, max-age=3600",
                "Accept-Ranges": "bytes",
            }
            for key in (
                "content-length",
                "content-range",
                "accept-ranges",
                "etag",
                "last-modified",
            ):
                if key in upstream.headers:
                    response_headers[key.title()] = upstream.headers[key]

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
            raise HTTPException(
                status_code=exc.response.status_code, detail="Video not found"
            ) from exc
        except Exception as exc:
            try:
                await stream_cm.__aexit__(type(exc), exc, exc.__traceback__)
            finally:
                await client.aclose()
            logger.error("Error proxying transcoded video: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    filepath = _resolve_transcoded_path(filename)
    if not filepath.exists():
        logger.error("Transcoded video not found: %s", filepath)
        raise HTTPException(status_code=404, detail="Video not found")

    logger.info("Serving transcoded video: %s", filename)
    return FileResponse(
        filepath,
        media_type="video/mp4",
        filename=filename,
        headers={
            "Cache-Control": "public, max-age=3600",
            "Accept-Ranges": "bytes",
        },
    )


@router.head("/sora/{task_id}.mp4")
async def head_fake_sora_video(task_id: str, request: Request) -> Response:
    """HEAD request for fake Sora result URLs.

    In `SORA_PROVIDER=fake`, the webhook payload includes `resultUrls` pointing
    at this endpoint to mimic Sora hosting a downloadable MP4.
    """
    _require_media_token(request)
    _validate_task_id(task_id)
    path = resolve_fake_sora_clip(task_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    file_size = path.stat().st_size
    return Response(
        content=b"",
        media_type="video/mp4",
        headers={
            "Content-Length": str(file_size),
            "Content-Disposition": f'inline; filename="{task_id}.mp4"',
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
        },
    )


@router.get("/sora/{task_id}.mp4")
async def get_fake_sora_video(task_id: str, request: Request) -> FileResponse:
    """Serve fake Sora MP4s for contract-exact local runs."""
    _require_media_token(request)
    _validate_task_id(task_id)
    path = resolve_fake_sora_clip(task_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"{task_id}.mp4",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Accept-Ranges": "bytes",
        },
    )
