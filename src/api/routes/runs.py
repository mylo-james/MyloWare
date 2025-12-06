"""Runs management endpoints."""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.dependencies import (
    get_artifact_repo,
    get_llama_client,
    get_run_repo,
    get_vector_db_id,
)
from storage.repositories import ArtifactRepository, RunRepository
from workflows.hitl import approve_gate
from workflows.orchestrator import (
    create_pending_run,
    run_workflow_async,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Runs"])

# Rate limiter for run endpoints
limiter = Limiter(key_func=get_remote_address)


class StartRunRequest(BaseModel):
    """Request to start a new workflow run."""

    model_config = {"populate_by_name": True}  # Accept both 'workflow' and 'project'

    workflow: str = Field(
        default="aismr",
        max_length=64,
        pattern=r"^[a-z0-9_]+$",
        description="Workflow/project name",
        alias="project",  # Accept both 'workflow' and 'project' keys
    )
    brief: str = Field(
        ...,
        max_length=10000,
        description="User's brief/prompt",
    )
    user_id: Optional[str] = Field(
        default=None,
        max_length=128,
        description="Optional user identifier",
    )
    telegram_chat_id: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Optional Telegram chat ID",
    )


class StartRunResponse(BaseModel):
    run_id: str
    status: str


class ApproveRequest(BaseModel):
    content_override: Optional[str] = None


@router.post("/start", response_model=StartRunResponse)
@limiter.limit("10/minute")
async def start_run(
    request: Request,
    body: StartRunRequest,
    background_tasks: BackgroundTasks,
    run_repo: RunRepository = Depends(get_run_repo),
    client=Depends(get_llama_client),
    vector_db_id: str = Depends(get_vector_db_id),
) -> StartRunResponse:
    """Start a new workflow run.

    Creates a pending run and kicks off workflow execution in the background.
    Returns immediately with the run_id.
    """
    try:
        # Create pending run (synchronous, quick)
        run_id = create_pending_run(
            run_repo=run_repo,
            workflow_name=body.workflow,
            brief=body.brief,
            user_id=body.user_id,
            telegram_chat_id=body.telegram_chat_id,
        )

        # Execute workflow in background (async, slow)
        # Note: run_workflow_async creates its own DB session to avoid
        # request-scoped session lifecycle issues
        background_tasks.add_task(
            run_workflow_async,
            client=client,
            run_id=run_id,
            vector_db_id=vector_db_id,
        )

        return StartRunResponse(run_id=str(run_id), status="pending")

    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive fail-fast
        logger.exception("Failed to start workflow: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to start workflow") from exc


@router.get("/{run_id}")
async def get_run(
    run_id: UUID,
    run_repo: RunRepository = Depends(get_run_repo),
):
    """Get run status and artifacts."""

    run = run_repo.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    return {
        "run_id": str(run.id),
        "workflow_name": run.workflow_name,
        "status": run.status,
        "current_step": run.current_step,
        "artifacts": run.artifacts or {},
        "error": run.error,
    }


@router.post("/{run_id}/approve/{gate}")
@limiter.limit("10/minute")
async def approve_run(
    request: Request,
    run_id: UUID,
    gate: str,
    body: ApproveRequest,
    background_tasks: BackgroundTasks,
    run_repo: RunRepository = Depends(get_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_artifact_repo),
    client=Depends(get_llama_client),
    vector_db_id: str = Depends(get_vector_db_id),
):
    """Approve a HITL gate.

    Note: Gate approval still runs synchronously as it needs to return
    the updated status. Consider moving to background for production.
    """
    _ = background_tasks  # Reserved for future async gate approval

    try:
        result = approve_gate(
            client=client,
            run_id=run_id,
            gate=gate,
            run_repo=run_repo,
            artifact_repo=artifact_repo,
            vector_db_id=vector_db_id,
            content_override=body.content_override,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive fail-fast
        logger.exception("Failed to approve gate: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to approve gate") from exc

    return {
        "run_id": str(result.run_id),
        "status": result.status if isinstance(result.status, str) else result.status.value,
        "current_step": result.current_step,
        "artifacts": result.artifacts,
        "error": result.error,
    }


__all__ = [
    "router",
    "StartRunRequest",
    "StartRunResponse",
    "ApproveRequest",
]
