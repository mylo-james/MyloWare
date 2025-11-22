"""kie.ai webhook ingestion."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ...deps import get_database, get_video_gen_service
from ...services.test_video_gen import VideoGenService
from ...storage import Database
from .common import validate_and_extract_webhook

router = APIRouter()


@router.post("/kieai")
async def kieai_webhook(
    request: Request,
    db: Annotated[Database, Depends(get_database)],
    service: Annotated[VideoGenService, Depends(get_video_gen_service)],
) -> dict[str, object]:
    headers, payload = await validate_and_extract_webhook(
        request,
        db=db,
        provider="kieai",
    )
    result = service.handle_kieai_event(
        headers=headers,
        payload=payload,
        run_id=request.query_params.get("run_id"),
    )
    if result.get("status") == "invalid":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid signature")
    response: dict[str, str | int] = {"status": result.get("status", "accepted")}
    if result.get("run_id"):
        response["runId"] = str(result["run_id"])
    if "video_index" in result:
        response["videoIndex"] = result["video_index"]  # type: ignore[assignment]
    return response
