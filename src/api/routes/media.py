"""Media proxy endpoint to serve Remotion output and transcoded videos."""

import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, Response, FileResponse
import httpx

from config import settings
from observability.logging import get_logger

router = APIRouter(prefix="/v1/media", tags=["media"])
logger = get_logger(__name__)

# Directory for transcoded OpenAI Sora videos
TRANSCODED_DIR = "/tmp/myloware_videos"


def _get_video_url(video_id: str) -> str:
    """Build the Remotion video URL."""
    remotion_url = getattr(settings, "remotion_service_url", "http://localhost:3001")
    return f"{remotion_url}/output/{video_id}.mp4"


@router.head("/video/{video_id}")
async def head_video(video_id: str) -> Response:
    """HEAD request for video - allows URL validation without downloading."""
    video_url = _get_video_url(video_id)

    logger.info("HEAD request for video: %s", video_url)

    try:
        async with httpx.AsyncClient() as client:
            # Just check if the video exists and get size
            response = await client.head(video_url, timeout=30.0, follow_redirects=True)

            if response.status_code == 405:
                # Remotion might not support HEAD, try GET with stream
                response = await client.get(video_url, timeout=30.0)
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
    video_url = _get_video_url(video_id)

    logger.info("Proxying video: %s", video_url)

    range_header = request.headers.get("range")
    headers = {"Range": range_header} if range_header else None

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
async def head_transcoded_video(filename: str) -> Response:
    """HEAD request for transcoded OpenAI Sora video."""
    filepath = os.path.join(TRANSCODED_DIR, filename)

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Video not found")

    file_size = os.path.getsize(filepath)

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
async def get_transcoded_video(filename: str) -> FileResponse:
    """Serve transcoded OpenAI Sora videos.

    OpenAI Sora videos are transcoded to H.264/AAC on webhook receipt
    to ensure compatibility with Remotion's Chromium renderer.
    """
    filepath = os.path.join(TRANSCODED_DIR, filename)

    if not os.path.exists(filepath):
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
