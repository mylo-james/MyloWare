"""LangGraph workflow API endpoints (v2)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from langgraph.types import Command
from pydantic import BaseModel, Field
from slowapi import Limiter

from myloware.api.rate_limit import key_api_key_or_ip
from myloware.api.dependencies import get_vector_db_id
from myloware.api.schemas import ErrorResponse, ResumeRunResponse, RunDetailResponse
from myloware.config import settings
from myloware.llama_clients import get_async_client
from myloware.observability.logging import get_logger
from myloware.safety import check_brief_safety
from myloware.storage.database import get_async_session_factory
from myloware.storage.models import RunStatus
from myloware.storage.repositories import RunRepository
from myloware.workflows.langgraph.graph import LangGraphEngine, get_langgraph_engine
from myloware.workflows.langgraph.state import VideoWorkflowState

logger = get_logger(__name__)

router = APIRouter(prefix="/v2/runs", tags=["LangGraph Workflows"])
limiter = Limiter(key_func=key_api_key_or_ip)


def _engine_from_request(request: Request) -> LangGraphEngine:
    """Get LangGraphEngine from app.state (fallbacks to process default)."""
    engine = getattr(request.app.state, "langgraph_engine", None)
    if isinstance(engine, LangGraphEngine):
        return engine
    # Defensive fallback for tests/custom app instantiation.
    engine = get_langgraph_engine()
    request.app.state.langgraph_engine = engine
    return engine


class StartRunRequest(BaseModel):
    """Request to start a new LangGraph workflow run."""

    workflow: str = Field(
        default="aismr",
        max_length=64,
        pattern=r"^[a-z0-9_]+$",
        description="Workflow/project name",
    )
    brief: str = Field(
        ...,
        max_length=10000,
        description="User's brief/prompt",
    )
    user_id: str | None = Field(
        default=None,
        max_length=128,
        description="Optional user identifier",
    )
    telegram_chat_id: str | None = Field(
        default=None,
        max_length=64,
        description="Optional Telegram chat ID",
    )


class StartRunResponse(BaseModel):
    """Response from starting a workflow."""

    run_id: str
    thread_id: str
    state: dict[str, Any]
    interrupt: dict[str, Any] | None = None


class ApproveRequest(BaseModel):
    """Request to approve an interrupt."""

    interrupt_id: str | None = Field(
        default=None,
        description="Optional interrupt id to resume (required when multiple interrupts are pending).",
    )
    approved: bool = Field(..., description="Whether to approve")
    comment: str | None = Field(default=None, description="Optional approval comment")
    data: dict[str, Any] | None = Field(default=None, description="Additional data for resume")


class RejectRequest(BaseModel):
    """Request to reject an interrupt."""

    interrupt_id: str | None = Field(
        default=None,
        description="Optional interrupt id to resume (required when multiple interrupts are pending).",
    )
    comment: str | None = Field(default=None, description="Rejection reason")


class ResumeRunRequest(BaseModel):
    """Request to resume or rewind a run using existing artifacts."""

    action: str = Field(
        default="auto",
        description=(
            "Resume action: auto|videos|render|publish|repair-render|repair-videos|fork-from-clips. "
            "auto selects based on current run status."
        ),
    )
    approve_publish: bool = Field(
        default=False,
        description="Required to advance publish gate when action=publish or auto hits publish gate.",
    )
    force: bool = Field(
        default=False,
        description="Allow resume even if run status is not normally replayable.",
    )
    checkpoint_id: str | None = Field(
        default=None,
        description="Optional checkpoint_id for fork-from-clips action.",
    )
    video_indexes: list[int] | None = Field(
        default=None,
        description="Optional 0-based indexes to repair when action=repair-videos.",
    )


class StateResponse(BaseModel):
    """Response with workflow state."""

    state: dict[str, Any]
    next: list[str] | None = None
    interrupts: list[dict[str, Any]] | None = None


@router.post(
    "/start",
    response_model=StartRunResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
@limiter.limit(lambda: settings.run_rate_limit)
async def start_run(
    request: Request,
    body: StartRunRequest,
    vector_db_id: str = Depends(get_vector_db_id),
) -> StartRunResponse:
    """Start a new LangGraph workflow run.

    Creates a run in the database and starts the workflow graph.
    Returns immediately if the graph hits an interrupt (HITL or webhook wait).
    """
    if not settings.use_langgraph_engine:
        raise HTTPException(
            status_code=501,
            detail="LangGraph engine is not enabled. Set USE_LANGGRAPH_ENGINE=true",
        )

    # Safety check (fail-closed). Route-level check prevents creating runs when shields reject
    # or are unavailable; middleware also enforces safety on all write endpoints.
    if settings.enable_safety_shields:
        try:
            logger.info(
                "Starting brief safety check",
                brief_length=len(body.brief),
                settings_shield=settings.content_safety_shield_id,
            )
            # Explicitly pass shield_id to avoid any default value issues
            async_client = get_async_client()
            safety_result = await check_brief_safety(
                async_client, body.brief, shield_id=settings.content_safety_shield_id
            )
            logger.info(
                "Brief safety check completed",
                safe=safety_result.safe,
                category=getattr(safety_result, "category", None),
                reason=getattr(safety_result, "reason", None),
            )
            if not safety_result.safe:
                category = getattr(safety_result, "category", None)
                reason = safety_result.reason or "Content policy violation"
                logger.warning("Brief failed safety check", category=category, reason=reason)
                if category == "system_error":
                    raise HTTPException(status_code=503, detail="Safety check unavailable")
                raise HTTPException(status_code=400, detail=f"Brief failed safety check: {reason}")
        except HTTPException:
            raise
        except Exception as exc:
            # Unexpected exception - fail closed (safety is critical)
            logger.error(
                "Safety check exception in route handler",
                exc=str(exc),
                exc_type=type(exc).__name__,
                exc_repr=repr(exc),
                traceback=True,
            )
            # Fail closed: safety check failures block requests
            raise HTTPException(
                status_code=500,
                detail="Safety check unavailable",
            )

    # Budget guard (UTC to avoid tz drift)
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)
    # Create run in database (async session to avoid blocking)
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        try:
            from myloware.config.projects import load_project

            load_project(body.workflow)  # Validate project exists
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"Workflow '{body.workflow}' not found")

        # Rough cost/rate guard using run counts over last 24h.
        recent_count = 0
        if hasattr(run_repo, "count_runs_since_async"):
            recent_count = await run_repo.count_runs_since_async(window_start)
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

        run = await run_repo.create_async(
            workflow_name=body.workflow,
            input=body.brief,
            vector_db_id=vector_db_id,
            user_id=body.user_id,
            telegram_chat_id=body.telegram_chat_id,
            status=RunStatus.RUNNING,
            current_step="ideation",
        )
        await session.commit()

    # Initialize state
    thread_id = str(run.id)
    initial_state: VideoWorkflowState = {
        "run_id": str(run.id),
        "project": body.workflow,
        "brief": body.brief,
        "vector_db_id": vector_db_id,
        "user_id": body.user_id,
        "telegram_chat_id": body.telegram_chat_id,
        "ideas_approved": False,
        "production_complete": False,
        "publish_approved": False,
        "published_urls": [],
        "pending_task_ids": [],
        "video_clips": [],
        "status": RunStatus.RUNNING.value,
        "current_step": "ideation",
    }

    # Ensure async checkpointer is initialized for Postgres
    if not settings.database_url.startswith("sqlite"):
        await _engine_from_request(request).ensure_checkpointer_initialized()

    # Get graph and invoke
    graph = _engine_from_request(request).get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    try:
        # Use durability="sync" for parity/Postgres invocations
        result = await graph.ainvoke(initial_state, config=config, durability="sync")

        # Check for interrupts
        graph_state = await graph.aget_state(config)
        interrupts = graph_state.interrupts if hasattr(graph_state, "interrupts") else []

        interrupt_data = None
        if interrupts:
            # Return first interrupt
            interrupt_data = {
                "id": interrupts[0].id if hasattr(interrupts[0], "id") else str(uuid4()),
                "value": interrupts[0].value if hasattr(interrupts[0], "value") else {},
                "resumable": (
                    interrupts[0].resumable if hasattr(interrupts[0], "resumable") else True
                ),
            }

        # Persist latest status/current_step so DB mirrors graph state (important in fake mode)
        try:
            SessionLocal = get_async_session_factory()
            async with SessionLocal() as status_session:
                status_repo = RunRepository(status_session)
                await status_repo.update_async(
                    run.id,
                    status=result.get("status", RunStatus.COMPLETED.value),
                    current_step=result.get("current_step", "completed"),
                )
                await status_session.commit()
        except Exception as status_exc:  # pragma: no cover - defensive logging only
            logger.warning("Failed to persist LangGraph result to run %s: %s", run.id, status_exc)

        return StartRunResponse(
            run_id=str(run.id),
            thread_id=thread_id,
            state=result,
            interrupt=interrupt_data,
        )

    except Exception as exc:
        logger.exception("Failed to start LangGraph workflow: %s", exc)
        # Create new session for error handling since the original session is closed
        SessionLocal = get_async_session_factory()
        async with SessionLocal() as error_session:
            error_run_repo = RunRepository(error_session)
            await error_run_repo.update_async(run.id, status=RunStatus.FAILED.value)
            await error_session.commit()
        raise HTTPException(status_code=500, detail=f"Workflow start failed: {str(exc)}")


@router.get(
    "/{run_id}",
    response_model=RunDetailResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_run(
    run_id: UUID,
) -> RunDetailResponse:
    """Get run status and artifacts (DB projection, not LangGraph state)."""
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
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


@router.post(
    "/{run_id}/approve",
    response_model=StateResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def approve_interrupt(
    request: Request,
    run_id: str,
    body: ApproveRequest,
) -> StateResponse:
    """Approve an interrupt and resume workflow.

    Used for HITL approval gates (ideation approval, publish approval).
    """
    if not settings.use_langgraph_engine:
        raise HTTPException(status_code=501, detail="LangGraph engine is not enabled")

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        run = await run_repo.get_async(UUID(run_id))
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        thread_id = str(run.id)  # thread_id == run_id
        config = {"configurable": {"thread_id": thread_id}}

        if not settings.database_url.startswith("sqlite"):
            await _engine_from_request(request).ensure_checkpointer_initialized()
        graph = _engine_from_request(request).get_graph()
        graph_state = await graph.aget_state(config)

        interrupts_obj = getattr(graph_state, "interrupts", None)
        if not interrupts_obj:
            raise HTTPException(status_code=400, detail="No pending interrupts for this run")

        resume_data = {
            "approved": body.approved,
            "comment": body.comment,
        }
        if body.data:
            resume_data.update(body.data)

        try:
            interrupt_id = None

            if body.interrupt_id:
                interrupt_id = body.interrupt_id
                # Best-effort validation when interrupts are iterable.
                try:
                    interrupts_list = list(interrupts_obj)
                except Exception:
                    interrupts_list = None
                if interrupts_list is not None:
                    known_ids = {
                        (getattr(i, "id", None) or getattr(i, "interrupt_id", None))
                        for i in interrupts_list
                    }
                    if interrupt_id not in known_ids:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Unknown interrupt_id: {interrupt_id}",
                        )
            else:
                # Prefer enforcing explicit ids when multiple interrupts are pending.
                try:
                    interrupts_list = list(interrupts_obj)
                except Exception:
                    interrupts_list = None
                if interrupts_list is not None:
                    if len(interrupts_list) != 1:
                        raise HTTPException(
                            status_code=400,
                            detail="interrupt_id is required when multiple interrupts are pending",
                        )
                    first_interrupt = interrupts_list[0]
                    interrupt_id = getattr(first_interrupt, "id", None) or getattr(
                        first_interrupt, "interrupt_id", None
                    )
                else:
                    # Fallback: avoid failing hard on unexpected interrupt container shapes.
                    try:
                        first_interrupt = interrupts_obj[0]  # type: ignore[index]
                        interrupt_id = getattr(first_interrupt, "id", None) or getattr(
                            first_interrupt, "interrupt_id", None
                        )
                    except Exception:
                        interrupt_id = None

            resume_argument = {interrupt_id: resume_data} if interrupt_id else resume_data

            # Use durability="sync" for parity/Postgres invocations
            result = await graph.ainvoke(
                Command(resume=resume_argument), config=config, durability="sync"
            )
            new_state = await graph.aget_state(config)

            return StateResponse(
                state=result,
                next=(
                    list(new_state.next) if hasattr(new_state, "next") and new_state.next else None
                ),
                interrupts=(
                    [
                        {
                            "id": i.id if hasattr(i, "id") else str(uuid4()),
                            "value": i.value if hasattr(i, "value") else {},
                        }
                        for i in (new_state.interrupts or [])
                    ]
                    if hasattr(new_state, "interrupts") and new_state.interrupts
                    else None
                ),
            )
        except Exception as exc:
            logger.exception("Failed to approve interrupt: %s", exc)
            raise HTTPException(status_code=500, detail=f"Approval failed: {str(exc)}")


# Alias endpoint to replace legacy HITL approve path
@router.post(
    "/{run_id}/approve/hitl",
    response_model=StateResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def approve_hitl_gate(
    request: Request,
    run_id: str,
    body: ApproveRequest,
) -> StateResponse:
    """Explicit HITL approval endpoint (LangGraph)."""
    return await approve_interrupt(request, run_id, body)


@router.post(
    "/{run_id}/resume",
    response_model=ResumeRunResponse,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def resume_run_endpoint(
    run_id: str,
    body: ResumeRunRequest,
) -> ResumeRunResponse:
    """Operator-only resume/rewind using existing artifacts (no automatic retries)."""
    try:
        run_uuid = UUID(run_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid run_id") from exc

    from myloware.workflows.langgraph.workflow import resume_run

    try:
        outcome = await resume_run(
            run_uuid,
            action=body.action,
            approve_publish=body.approve_publish,
            force=body.force,
            checkpoint_id=body.checkpoint_id,
            video_indexes=body.video_indexes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    action = outcome.get("action")
    message = outcome.get("message")

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        run = await run_repo.get_async(run_uuid)
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        return ResumeRunResponse(
            run_id=str(run.id),
            workflow_name=run.workflow_name,
            status=run.status,
            current_step=run.current_step,
            artifacts=run.artifacts or {},
            error=run.error,
            action=action,
            message=message,
        )


@router.post(
    "/{run_id}/reject",
    response_model=StateResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def reject_interrupt(
    request: Request,
    run_id: str,
    body: RejectRequest,
) -> StateResponse:
    """Reject an interrupt and end workflow."""
    if not settings.use_langgraph_engine:
        raise HTTPException(status_code=501, detail="LangGraph engine is not enabled")

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        run = await run_repo.get_async(UUID(run_id))
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        thread_id = str(run.id)
        config = {"configurable": {"thread_id": thread_id}}

        if not settings.database_url.startswith("sqlite"):
            await _engine_from_request(request).ensure_checkpointer_initialized()
        graph = _engine_from_request(request).get_graph()
        graph_state = await graph.aget_state(config)

        interrupts_obj = getattr(graph_state, "interrupts", None)
        if not interrupts_obj:
            raise HTTPException(status_code=400, detail="No pending interrupts for this run")

        resume_data = {
            "approved": False,
            "comment": body.comment or "Rejected by user",
        }

        try:
            interrupt_id = None
            if body.interrupt_id:
                interrupt_id = body.interrupt_id
                try:
                    interrupts_list = list(interrupts_obj)
                except Exception:
                    interrupts_list = None
                if interrupts_list is not None:
                    known_ids = {
                        (getattr(i, "id", None) or getattr(i, "interrupt_id", None))
                        for i in interrupts_list
                    }
                    if interrupt_id not in known_ids:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Unknown interrupt_id: {interrupt_id}",
                        )
            else:
                try:
                    interrupts_list = list(interrupts_obj)
                except Exception:
                    interrupts_list = None
                if interrupts_list is not None:
                    if len(interrupts_list) != 1:
                        raise HTTPException(
                            status_code=400,
                            detail="interrupt_id is required when multiple interrupts are pending",
                        )
                    first_interrupt = interrupts_list[0]
                    interrupt_id = getattr(first_interrupt, "id", None) or getattr(
                        first_interrupt, "interrupt_id", None
                    )
                else:
                    try:
                        first_interrupt = interrupts_obj[0]  # type: ignore[index]
                        interrupt_id = getattr(first_interrupt, "id", None) or getattr(
                            first_interrupt, "interrupt_id", None
                        )
                    except Exception:
                        interrupt_id = None

            resume_argument = {interrupt_id: resume_data} if interrupt_id else resume_data

            # Use durability="sync" for parity/Postgres invocations
            await graph.ainvoke(Command(resume=resume_argument), config=config, durability="sync")

            await run_repo.update_async(run.id, status=RunStatus.REJECTED.value)
            await session.commit()

            return StateResponse(
                state={},
                next=None,
                interrupts=None,
            )
        except Exception as exc:
            logger.exception("Failed to reject interrupt: %s", exc)
            raise HTTPException(status_code=500, detail=f"Rejection failed: {str(exc)}")


@router.get(
    "/{run_id}/state",
    response_model=StateResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_state(
    request: Request,
    run_id: str,
) -> StateResponse:
    """Get current workflow state."""
    if not settings.use_langgraph_engine:
        raise HTTPException(status_code=501, detail="LangGraph engine is not enabled")

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        run = await run_repo.get_async(UUID(run_id))
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        thread_id = str(run.id)
        config = {"configurable": {"thread_id": thread_id}}

        if not settings.database_url.startswith("sqlite"):
            await _engine_from_request(request).ensure_checkpointer_initialized()
        graph = _engine_from_request(request).get_graph()
        graph_state = await graph.aget_state(config)

        # LangGraph checkpoint values are the single source of orchestration truth.
        state_values = dict(graph_state.values) if hasattr(graph_state, "values") else {}

        return StateResponse(
            state=state_values,
            next=(
                list(graph_state.next)
                if hasattr(graph_state, "next") and graph_state.next
                else None
            ),
            interrupts=(
                [
                    {
                        "id": i.id if hasattr(i, "id") else str(uuid4()),
                        "value": i.value if hasattr(i, "value") else {},
                    }
                    for i in (graph_state.interrupts or [])
                ]
                if hasattr(graph_state, "interrupts") and graph_state.interrupts
                else None
            ),
        )


@router.get(
    "/{run_id}/history",
    responses={404: {"model": ErrorResponse}},
)
async def get_history(
    request: Request,
    run_id: str,
) -> list[dict[str, Any]]:
    """Get workflow checkpoint history (time-travel debugging)."""
    if not settings.use_langgraph_engine:
        raise HTTPException(status_code=501, detail="LangGraph engine is not enabled")

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        run = await run_repo.get_async(UUID(run_id))
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        thread_id = str(run.id)
        config = {"configurable": {"thread_id": thread_id}}

        if not settings.database_url.startswith("sqlite"):
            await _engine_from_request(request).ensure_checkpointer_initialized()
        graph = _engine_from_request(request).get_graph()
        history = []

        try:
            async for checkpoint in graph.aget_state_history(config):
                history.append(
                    {
                        "checkpoint_id": checkpoint.config.get("configurable", {}).get(
                            "checkpoint_id"
                        ),
                        "values": checkpoint.values if hasattr(checkpoint, "values") else {},
                        "next": (
                            list(checkpoint.next)
                            if hasattr(checkpoint, "next") and checkpoint.next
                            else None
                        ),
                    }
                )
        except Exception as exc:
            logger.warning("Failed to get history: %s", exc)

        return history
