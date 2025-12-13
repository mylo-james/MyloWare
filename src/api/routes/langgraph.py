"""LangGraph workflow API endpoints (v2)."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from langgraph.types import Command
from pydantic import BaseModel, Field

from api.dependencies import get_vector_db_id
from llama_clients import get_async_client
from api.schemas import ErrorResponse
from config import settings
from observability.logging import get_logger
from safety import check_brief_safety
from storage.database import get_async_session_factory
from storage.models import RunStatus
from storage.repositories import RunRepository
from workflows.langgraph.graph import get_graph, ensure_checkpointer_initialized
from workflows.langgraph.state import VideoWorkflowState

logger = get_logger(__name__)

router = APIRouter(prefix="/v2/runs", tags=["LangGraph Workflows"])


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

    approved: bool = Field(..., description="Whether to approve")
    comment: str | None = Field(default=None, description="Optional approval comment")
    data: dict[str, Any] | None = Field(default=None, description="Additional data for resume")


class RejectRequest(BaseModel):
    """Request to reject an interrupt."""

    comment: str | None = Field(default=None, description="Rejection reason")


class ForkFromClipsRequest(BaseModel):
    """Request to fork a run from existing clips."""

    checkpoint_id: str | None = Field(
        default=None,
        description="Optional checkpoint_id to fork from (defaults to last Sora wait checkpoint)",
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

    # Create run in database (async session to avoid blocking)
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        try:
            from config.projects import load_project

            load_project(body.workflow)  # Validate project exists
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"Workflow '{body.workflow}' not found")

        run = await run_repo.create_async(
            workflow_name=body.workflow,
            brief=body.brief,
            user_id=body.user_id,
            telegram_chat_id=body.telegram_chat_id,
        )
        # Mark as running immediately so watchers don't see a stuck PENDING run
        await run_repo.update_async(run.id, status=RunStatus.RUNNING.value, current_step="ideation")
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
        "status": RunStatus.PENDING.value,
        "current_step": "ideation",
    }

    # Ensure async checkpointer is initialized for Postgres
    if not settings.database_url.startswith("sqlite"):
        await ensure_checkpointer_initialized()

    # Get graph and invoke
    graph = get_graph()
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
            await ensure_checkpointer_initialized()
        graph = get_graph()
        graph_state = await graph.aget_state(config)

        # If there is no pending interrupt but the caller explicitly rejects, fail fast
        if not graph_state.interrupts:
            if body.approved is False:
                await run_repo.update_async(
                    run.id,
                    status=RunStatus.REJECTED.value,
                    current_step=run.current_step or "ideation",
                    artifacts={**(run.artifacts or {}), "ideas_approved": False},
                )
                await session.commit()
                return StateResponse(
                    state={"status": RunStatus.REJECTED.value, "ideas_approved": False},
                    next=None,
                    interrupts=None,
                )

            # Nothing to approve; return current state
            state_values = graph_state.values if hasattr(graph_state, "values") else {}
            state_values = dict(state_values)
            if run.status:
                state_values["status"] = run.status
            if run.current_step:
                state_values["current_step"] = run.current_step
            return StateResponse(
                state=state_values,
                next=(
                    list(graph_state.next)
                    if hasattr(graph_state, "next") and graph_state.next
                    else None
                ),
                interrupts=None,
            )

        resume_data = {
            "approved": body.approved,
            "comment": body.comment,
        }
        if body.data:
            resume_data.update(body.data)

        try:
            interrupt_id = None
            try:
                first_interrupt = (graph_state.interrupts or [])[0]
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
    "/{run_id}/fork-from-clips",
    response_model=StateResponse,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def fork_from_clips_endpoint(
    request: Request,
    run_id: str,
    body: ForkFromClipsRequest,
) -> StateResponse:
    """Operator-only recovery: fork from existing VIDEO_CLIP artifacts and resume editing.

    This uses LangGraph time travel (__copy__ fork) to resume the wait_for_videos
    interrupt with already-generated clips, avoiding new Sora spend.
    """
    if not settings.use_langgraph_engine:
        raise HTTPException(status_code=501, detail="LangGraph engine is not enabled")

    try:
        run_uuid = UUID(run_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid run_id") from exc

    from workflows.langgraph.workflow import fork_from_clips

    try:
        await fork_from_clips(run_uuid, checkpoint_id=body.checkpoint_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Return latest forked state from LangGraph.
    thread_id = str(run_uuid)
    config = {"configurable": {"thread_id": thread_id}}
    if not settings.database_url.startswith("sqlite"):
        await ensure_checkpointer_initialized()
    graph = get_graph()
    graph_state = await graph.aget_state(config)
    state_values = dict(graph_state.values) if hasattr(graph_state, "values") else {}

    return StateResponse(
        state=state_values,
        next=list(graph_state.next) if getattr(graph_state, "next", None) else None,
        interrupts=(
            [
                {
                    "id": i.id if hasattr(i, "id") else str(uuid4()),
                    "value": i.value if hasattr(i, "value") else {},
                }
                for i in (graph_state.interrupts or [])
            ]
            if getattr(graph_state, "interrupts", None)
            else None
        ),
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
            await ensure_checkpointer_initialized()
        graph = get_graph()
        graph_state = await graph.aget_state(config)

        if not graph_state.interrupts:
            raise HTTPException(status_code=400, detail="No pending interrupts for this run")

        resume_data = {
            "approved": False,
            "comment": body.comment or "Rejected by user",
        }

        try:
            # Use durability="sync" for parity/Postgres invocations
            await graph.ainvoke(Command(resume=resume_data), config=config, durability="sync")

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
            await ensure_checkpointer_initialized()
        graph = get_graph()
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
            await ensure_checkpointer_initialized()
        graph = get_graph()
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
