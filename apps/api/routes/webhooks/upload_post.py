"""upload-post webhook ingestion."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ...deps import get_database, get_video_gen_service
from ...services.test_video_gen import VideoGenService
from ...storage import Database
from .common import validate_and_extract_webhook

router = APIRouter()


@router.post("/upload-post")
async def upload_post_webhook(
    request: Request,
    db: Annotated[Database, Depends(get_database)],
    service: Annotated[VideoGenService, Depends(get_video_gen_service)],
) -> dict[str, str]:
    headers, payload = await validate_and_extract_webhook(
        request,
        db=db,
        provider="upload-post",
    )
    result = service.handle_upload_post_webhook(headers=headers, payload=payload)
    if result.get("status") == "invalid":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid signature")
    return {"status": result.get("status", "accepted")}
