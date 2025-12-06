"""Media proxy endpoint to serve Remotion output and transcoded videos."""

import logging
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, Response, FileResponse
import httpx

from config import settings

router = APIRouter(prefix="/v1/media", tags=["media"])
logger = logging.getLogger(__name__)

# Directory for transcoded KIE.ai videos
TRANSCODED_DIR = "/tmp/myloware_videos"


def _get_video_url(video_id: str) -> str:
    """Build the Remotion video URL."""
    remotion_url = getattr(settings, "remotion_service_url", "http://localhost:3001")
    return f"{remotion_url}/output/{video_id}.mp4"


@router.head("/video/{video_id}")
async def head_video(video_id: str):
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
                }
            )
    except httpx.HTTPStatusError as e:
        logger.error("HEAD failed: %s", e)
        raise HTTPException(status_code=e.response.status_code, detail="Video not found")
    except Exception as e:
        logger.error("Error checking video: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video/{video_id}")
async def get_video(video_id: str):
    """Proxy Remotion rendered videos through the tunnel.
    
    This allows external services (like Upload-Post) to access
    locally rendered videos via the public tunnel URL.
    """
    video_url = _get_video_url(video_id)
    
    logger.info("Proxying video: %s", video_url)
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(video_url, timeout=120.0)
            response.raise_for_status()
            
            return StreamingResponse(
                iter([response.content]),
                media_type="video/mp4",
                headers={
                    "Content-Disposition": f'inline; filename="{video_id}.mp4"',
                    "Content-Length": str(len(response.content)),
                    "Cache-Control": "public, max-age=3600",
                    "Accept-Ranges": "bytes",
                }
            )
    except httpx.HTTPStatusError as e:
        logger.error("Failed to fetch video: %s", e)
        raise HTTPException(status_code=e.response.status_code, detail="Video not found")
    except Exception as e:
        logger.error("Error proxying video: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.head("/transcoded/{filename}")
async def head_transcoded_video(filename: str):
    """HEAD request for transcoded KIE.ai video."""
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
        }
    )


@router.get("/transcoded/{filename}")
async def get_transcoded_video(filename: str):
    """Serve transcoded KIE.ai videos.
    
    KIE.ai videos are transcoded to H.264/AAC on webhook receipt
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
        }
    )

