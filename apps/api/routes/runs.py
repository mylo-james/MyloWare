"""Run management endpoints."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Any, Literal, cast
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..deps import get_video_gen_service
from ..rate_limiter import rate_limit_dependency
from ..services.test_video_gen import VideoGenService

router = APIRouter(prefix="/v1/runs", tags=["runs"])


class RunStartInput(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    prompt: str | None = Field(default=None, min_length=3, max_length=400)
    object: str | None = Field(default=None, min_length=1, max_length=200)
    subject: str | None = Field(default=None, min_length=1, max_length=200)
    topic: str | None = Field(default=None, min_length=1, max_length=200)
    modifiers: list[str] | None = Field(default=None, description="Pre-seeded modifiers for AISMR runs")

    @model_validator(mode="after")
    def _ensure_value(self) -> "RunStartInput":
        if not any([self.title, self.prompt, self.object, self.subject, self.topic]):
            raise ValueError("Provide at least one of title, prompt, object, subject, or topic")
        return self


class RunStartRequest(BaseModel):
    project: Literal["test_video_gen", "aismr"]
    input: RunStartInput
    options: dict[str, Any] | None = Field(default=None, description="Project-specific run options")


class RunStartResponse(BaseModel):
    run_id: str = Field(alias="runId")
    status: str

    model_config = ConfigDict(populate_by_name=True)


class ArtifactResponse(BaseModel):
    id: UUID
    type: str
    url: str | None = None
    provider: str | None = None
    checksum: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(alias="createdAt")
    persona: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class RunStatusResponse(BaseModel):
    run_id: str = Field(alias="runId")
    project: str
    status: str
    result: dict[str, Any] | None = None
    artifacts: list[ArtifactResponse] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)

class RunContinueRequest(BaseModel):
    input: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    resume: dict[str, Any] | None = None


class RunCancelRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    actor: str | None = Field(default=None, max_length=200)


@router.post(
    "/start",
    response_model=RunStartResponse,
    dependencies=[Depends(rate_limit_dependency("runs_start"))],
)
async def start_run(
    payload: RunStartRequest,
    service: Annotated[VideoGenService, Depends(get_video_gen_service)],
) -> RunStartResponse:
    logger.info(
        "API: POST /v1/runs/start called",
        extra={"project": payload.project, "input": payload.input.model_dump(exclude_none=True)},
    )
    run_input = payload.input.model_dump(exclude_none=True)
    result = await run_in_threadpool(
        service.start_run,
        project=payload.project,
        run_input=run_input,
        options=payload.options or {},
    )
    logger.info(
        "API: start_run completed",
        extra={"run_id": result["run_id"], "status": result["status"]},
    )
    return RunStartResponse(runId=result["run_id"], status=result["status"])


@router.get("/{run_id}", response_model=RunStatusResponse)
async def get_run(
    run_id: str,
    service: Annotated[VideoGenService, Depends(get_video_gen_service)],
) -> RunStatusResponse:
    record = service.get_run(run_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")

    artifacts = [
        ArtifactResponse(
            id=UUID(str(item["id"])),
            type=item["type"],
            url=item.get("url"),
            provider=item.get("provider"),
            checksum=item.get("checksum"),
            metadata=_coerce_metadata(item.get("metadata")),
            createdAt=_coerce_datetime(item.get("created_at")),
            persona=item.get("persona"),
        )
        for item in service.list_artifacts(run_id)
    ]

    return RunStatusResponse(
        runId=record["run_id"],
        project=record["project"],
        status=record["status"],
        result=_coerce_optional_json(record.get("result")),
        artifacts=artifacts,
    )


logger = logging.getLogger("myloware.api.runs")


@router.post(
    "/{run_id}/continue",
    dependencies=[Depends(rate_limit_dependency("runs_continue"))],
)
async def continue_run(
    run_id: str,
    payload: RunContinueRequest,
    service: Annotated[VideoGenService, Depends(get_video_gen_service)],
) -> dict[str, Any]:
    """Continue a run by invoking the LangGraph orchestrator with prior state."""
    record = service.get_run(run_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    # Build videos spec from prior payload or result
    result = _coerce_optional_json(record.get("result")) or {}
    videos: list[dict[str, Any]] = []
    for item in result.get("videos", []):
        videos.append({"subject": item.get("subject"), "header": item.get("header")})
    orchestrator_payload = {
        "project": record.get("project"),
        "input": payload.input,
        "videos": videos,
        "metadata": payload.metadata or {},
    }
    if payload.resume is not None:
        orchestrator_payload["resume"] = payload.resume
    try:
        response = await run_in_threadpool(
            service._orchestrator.invoke,  # noqa: SLF001
            run_id,
            orchestrator_payload,
        )
    except httpx.HTTPError as exc:
        logger.error(
            "Orchestrator HTTP error while continuing run",
            extra={"run_id": run_id, "project": record.get("project")},
            exc_info=exc,
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="orchestrator unavailable") from exc
    except Exception as exc:
        logger.exception(
            "Unexpected error while continuing run",
            extra={"run_id": run_id, "project": record.get("project")},
        )
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="orchestrator error") from exc
    return cast(dict[str, Any], {"runId": run_id, "state": response.get("state", {}), "status": "ok"})


@router.post("/{run_id}/cancel")
async def cancel_run(
    run_id: str,
    payload: RunCancelRequest,
    service: Annotated[VideoGenService, Depends(get_video_gen_service)],
) -> dict[str, Any]:
    logger.info("API: POST /v1/runs/%s/cancel", run_id)
    try:
        result = service.cancel_run(run_id, reason=payload.reason, actor=payload.actor)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found") from None
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"runId": result["run_id"], "status": result["status"]}


def _coerce_metadata(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        import json

        return cast(dict[str, Any], json.loads(value))
    return dict(value)


def _coerce_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        from datetime import datetime as dt

        return dt.fromisoformat(value)
    raise ValueError("Unable to coerce datetime value")


def _coerce_optional_json(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    data = _coerce_metadata(value)
    return data if data else None
