"""Runs management endpoints."""

from __future__ import annotations

from typing import Optional
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from llama_stack_client import AsyncLlamaStackClient, LlamaStackClient
from pydantic import BaseModel, Field

from api.schemas import ErrorResponse, RunDetailResponse
from slowapi import Limiter

from api.rate_limit import key_api_key_or_ip

from api.dependencies import (
    get_llama_client,
    get_async_llama_client,
    get_vector_db_id,
)
from api.dependencies_async import get_async_run_repo
from config import settings
from observability.logging import get_logger
from safety import check_brief_safety
from storage.repositories import RunRepository
from workflows.langgraph.workflow import run_workflow_async


logger = get_logger(__name__)

router = APIRouter(tags=["Runs"])

# Rate limiter for run endpoints (API key preferred)
limiter = Limiter(key_func=key_api_key_or_ip)


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


@router.post(
    "/start",
    response_model=StartRunResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
# Rate limit for run starts; value can be overridden per-environment.
@limiter.limit(lambda: settings.run_rate_limit)
async def start_run(
    request: Request,
    body: StartRunRequest,
    background_tasks: BackgroundTasks,
    run_repo: RunRepository = Depends(get_async_run_repo),
    client: LlamaStackClient = Depends(get_llama_client),
    async_client: AsyncLlamaStackClient = Depends(get_async_llama_client),
    vector_db_id: str = Depends(get_vector_db_id),
) -> StartRunResponse:
    """Start a new workflow run.

    Creates a pending run and kicks off workflow execution in the background.
    Returns immediately with the run_id.
    """
    try:
        # Simple cost/rate guard using run counts over last 24h (UTC to avoid tz drift)
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(hours=24)
        if hasattr(run_repo, "count_runs_since_async"):
            recent_count = await run_repo.count_runs_since_async(window_start)
        else:
            recent_count = 0
        if settings.max_runs_last_24h and recent_count >= settings.max_runs_last_24h:
            raise HTTPException(
                status_code=429,
                detail="Run budget exceeded (max_runs_last_24h). Please retry later.",
            )
        estimated_cost = (recent_count + 1) * settings.estimated_cost_per_run_usd
        if settings.daily_cost_budget_usd and estimated_cost > settings.daily_cost_budget_usd:
            raise HTTPException(
                status_code=429,
                detail="Daily cost budget exceeded; try again tomorrow.",
            )
        # Pre-workflow safety check (Llama Stack native)
        # Catches unsafe content BEFORE expensive video generation
        if settings.enable_safety_shields:
            # Use async client to avoid blocking loop during pre-check
            safety_result = await check_brief_safety(async_client, body.brief)
            if not safety_result.safe:
                logger.warning(
                    "Brief rejected by safety shield",
                    reason=safety_result.reason,
                    category=safety_result.category,
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Brief rejected: {safety_result.reason or 'Content policy violation'}",
                )

        # Create pending run (offloaded to threadpool to avoid blocking event loop)
        run = await run_repo.create_async(
            workflow_name=body.workflow,
            brief=body.brief,
            user_id=body.user_id,
            telegram_chat_id=body.telegram_chat_id,
        )
        run_id = run.id

        # Commit run before kicking off background work so it is visible
        await run_repo.session.commit()

        if not settings.skip_run_visibility_check:
            # Verify the run is visible in a new async session before starting background task
            # This ensures transaction isolation issues are resolved before workflow starts.
            # We await until the run is actually visible, not just sleep.
            from storage.database import get_async_session_factory
            import asyncio

            verify_session_factory = get_async_session_factory()
            verify_run = None
            max_attempts = 10
            for attempt in range(max_attempts):
                async with verify_session_factory() as verify_session:
                    from storage.repositories import RunRepository as VerifyRunRepo

                    verify_repo = VerifyRunRepo(verify_session)
                    verify_run = await verify_repo.get_async(run_id)
                    if verify_run is not None:
                        break
                # Only wait if we haven't found it yet and there are more attempts
                if verify_run is None and attempt < max_attempts - 1:
                    await asyncio.sleep(0.05)

            if verify_run is None:
                logger.error(
                    "Run %s not visible after commit after %d attempts, cannot start workflow",
                    run_id,
                    max_attempts,
                )
                raise HTTPException(
                    status_code=500,
                    detail="Failed to verify run creation. Please try again.",
                )

        if not settings.disable_background_workflows:
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


@router.get("/{run_id}", response_model=RunDetailResponse)
async def get_run(
    run_id: UUID,
    run_repo: RunRepository = Depends(get_async_run_repo),
) -> RunDetailResponse:
    """Get run status and artifacts."""

    run = await run_repo.get_async(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    return RunDetailResponse(
        run_id=str(run.id),
        workflow_name=run.workflow_name,
        status=run.status,
        current_step=run.current_step,
        artifacts=run.artifacts or {},
        error=run.error,
    )


__all__ = [
    "router",
    "StartRunRequest",
    "StartRunResponse",
]
