"""LangGraph-based workflow execution - single source of truth.

This module replaces orchestrator.py and provides LangGraph-based workflow execution.
All workflow execution now goes through LangGraph for consistency and replayability.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Optional
from uuid import UUID

from config import settings
from langgraph.types import Command
from llama_stack_client import LlamaStackClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from observability.logging import get_logger
from storage.database import get_async_session_factory
from storage.models import RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.langgraph.graph import get_graph
from workflows.langgraph.state import VideoWorkflowState
from workflows.langgraph.utils import sorted_video_clip_urls
from workflows.state import WorkflowResult

logger = get_logger(__name__)

__all__ = [
    "run_workflow_async",
    "run_workflow",
    "continue_after_ideation",
    "continue_after_producer",
    "continue_after_render",
    "continue_after_publish_approval",
    "continue_after_publish",
    "fork_from_clips",
    "create_pending_run",
]


async def fork_from_clips(run_id: UUID, checkpoint_id: str | None = None) -> WorkflowResult:
    """Operator-only recovery: fork a run from an earlier wait_for_videos checkpoint.

    Reuses existing VIDEO_CLIP artifacts (no new Sora calls) and resumes the
    wait_for_videos interrupt on a new forked checkpoint using LangGraph time travel.

    Args:
        run_id: Existing run/thread UUID.
        checkpoint_id: Optional checkpoint_id to fork from. If omitted, the most
            recent checkpoint waiting for Sora is used.

    Returns:
        WorkflowResult reflecting the updated run after resume.

    Raises:
        ValueError if no suitable checkpoint or clips are found.
    """
    from workflows.langgraph.graph import ensure_checkpointer_initialized

    if not settings.database_url.startswith("sqlite"):
        await ensure_checkpointer_initialized()

    graph = get_graph()
    thread_id = str(run_id)
    base_config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}

    # Collect existing video clips from artifacts.
    SessionLocal = get_async_session_factory()
    async with _session_ctx(SessionLocal) as session:
        artifact_repo = ArtifactRepository(session)
        artifacts = await artifact_repo.get_by_run_async(run_id)
        video_urls = sorted_video_clip_urls(artifacts)

    if not video_urls:
        raise ValueError(f"No VIDEO_CLIP artifacts found for run {run_id}")

    # Find checkpoint to fork from.
    selected_checkpoint = None
    async for checkpoint in graph.aget_state_history(base_config):
        cp_id = None
        if getattr(checkpoint, "config", None):
            cp_id = checkpoint.config.get("configurable", {}).get("checkpoint_id")

        if checkpoint_id and cp_id != checkpoint_id:
            continue

        values = dict(getattr(checkpoint, "values", {}) or {})
        current_step = values.get("current_step")
        if current_step is None and isinstance(values.get("state"), dict):
            current_step = values["state"].get("current_step")

        interrupts = getattr(checkpoint, "interrupts", None) or []
        waiting_for_sora = False
        for intr in interrupts:
            intr_val = getattr(intr, "value", None) or {}
            if isinstance(intr_val, dict) and intr_val.get("waiting_for") == "sora_webhook":
                waiting_for_sora = True
                break

        if checkpoint_id:
            # Caller selected a specific checkpoint; require it to be at a Sora wait boundary.
            if not waiting_for_sora and current_step != "wait_for_videos":
                raise ValueError(
                    f"Checkpoint {checkpoint_id} is not a wait_for_videos/Sora checkpoint"
                )
            selected_checkpoint = checkpoint
            break

        # Auto-select only true Sora-wait checkpoints. Fail fast if none exist.
        if waiting_for_sora:
            selected_checkpoint = checkpoint
            break

    if not selected_checkpoint:
        raise ValueError(
            f"No sora_webhook wait checkpoint found for run {run_id}. "
            "Provide --checkpoint-id from /v2/runs/{id}/history to force a fork."
        )

    if not getattr(selected_checkpoint, "config", None):
        raise ValueError(f"Selected checkpoint missing config for run {run_id}")

    # Fork and patch state using __copy__ to preserve location/interrupts.
    patch_values: dict[str, Any] = {
        "video_clips": video_urls,
        "production_complete": True,
        "status": RunStatus.RUNNING.value,
        "current_step": "wait_for_videos",
        "error": None,
    }

    fork_config = await graph.aupdate_state(
        selected_checkpoint.config,
        patch_values,
        as_node="__copy__",
    )

    # Resume wait_for_videos interrupt on the fork.
    fork_state = await graph.aget_state(fork_config)
    fork_interrupts = getattr(fork_state, "interrupts", None) or []
    interrupt_id = None
    for intr in fork_interrupts:
        intr_val = getattr(intr, "value", None) or {}
        if isinstance(intr_val, dict) and intr_val.get("waiting_for") == "sora_webhook":
            interrupt_id = getattr(intr, "id", None) or getattr(intr, "interrupt_id", None)
            break
    if not interrupt_id:
        raise ValueError(
            f"Forked checkpoint has no sora_webhook interrupt for run {run_id}; refusing to resume"
        )

    resume_payload: dict[str, Any] = {interrupt_id: {"video_urls": video_urls}}

    await graph.ainvoke(Command(resume=resume_payload), config=fork_config, durability="sync")

    # Return DB projection.
    SessionLocal = get_async_session_factory()
    async with _session_ctx(SessionLocal) as session:
        run_repo = RunRepository(session)
        updated_run = await run_repo.get_async(run_id)

    return WorkflowResult(
        run_id=str(run_id),
        status=updated_run.status if updated_run else RunStatus.FAILED.value,
        current_step=updated_run.current_step or "unknown" if updated_run else "unknown",
        error=updated_run.error if updated_run else None,
    )


# Helper to support both callable session factories and preconstructed context managers
def _session_ctx(session_factory: Any):
    # Already a context manager
    if hasattr(session_factory, "__aenter__") and hasattr(session_factory, "__aexit__"):
        return session_factory
    # Callable factory -> invoke to get context manager
    if callable(session_factory):
        candidate = session_factory()
        # If invocation returns a coroutine, await it to get the context manager
        if asyncio.iscoroutine(candidate):
            # Return an async context manager wrapper that awaits the coroutine once
            class _AwaitableCtx:
                def __init__(self, coro):
                    self._coro = coro
                    self._ctx = None

                async def __aenter__(self):
                    self._ctx = await self._coro
                    return await self._ctx.__aenter__()

                async def __aexit__(self, exc_type, exc, tb):
                    return await self._ctx.__aexit__(exc_type, exc, tb)

            return _AwaitableCtx(candidate)
        return candidate
    # Fallback: assume it's already a session
    return session_factory


async def create_pending_run(
    run_repo: RunRepository,
    workflow_name: str,
    brief: str,
    user_id: Optional[str] = None,
    telegram_chat_id: Optional[str] = None,
) -> UUID:
    """Create a new pending run entry in the database."""
    from config.projects import load_project

    load_project(workflow_name)  # Validate project exists

    run = await run_repo.create_async(
        workflow_name=workflow_name,
        user_id=user_id,
        input=brief,
        status=RunStatus.PENDING,
        telegram_chat_id=telegram_chat_id,
    )
    await run_repo.session.commit()
    logger.info("Created pending run: %s", run.id)
    return run.id


async def _wait_for_run_visibility(
    run_id: UUID,
    session_factory: Callable[[], async_sessionmaker[AsyncSession]] | Any,
    max_attempts: int = 10,
    delay: float = 0.05,
) -> None:
    """Poll until a run is visible to a new session.

    SQLite's default isolation can hide freshly committed rows from
    connections that start immediately afterward (especially when mixing
    sync TestClient and async sessions). This helper is used by
    background tasks to avoid failing when the row is not yet readable.
    """
    for attempt in range(max_attempts):
        async with _session_ctx(session_factory) as verify_session:
            verify_repo = RunRepository(verify_session)
            run = await verify_repo.get_async(run_id)
            if run is not None:
                return run
        if attempt < max_attempts - 1:
            await asyncio.sleep(delay)
    return None


async def run_workflow_async(
    client: LlamaStackClient,
    run_id: UUID,
    vector_db_id: str,
    notifier: Any | None = None,  # TelegramNotifier | None - avoid circular import
) -> None:
    """Execute workflow for an existing pending run using LangGraph.

    This is the async version that should be used in FastAPI background tasks.

    Note: The run should already be verified as visible before this task is started.
    This function assumes the run exists and will fail if it doesn't.
    """
    SessionLocal = get_async_session_factory()
    session_factory = SessionLocal if callable(SessionLocal) else (lambda: SessionLocal)

    # Ensure the run is visible before starting the workflow (handles SQLite read isolation)
    await _wait_for_run_visibility(run_id, session_factory)

    async with _session_ctx(SessionLocal) as session:
        run_repo = RunRepository(session)

        # Re-fetch the run within the session used for the workflow
        run = await run_repo.get_async(run_id)
        if run is None:
            logger.error("Run not found for async execution: %s", run_id)
            return

        try:
            await run_repo.update_async(run_id, status=RunStatus.RUNNING.value)
            await session.commit()

            logger.info("Starting LangGraph workflow %s (run_id=%s)", run.workflow_name, run_id)

            # Ensure checkpointer is initialized on this loop
            from workflows.langgraph.graph import ensure_checkpointer_initialized

            if not settings.database_url.startswith("sqlite"):
                await ensure_checkpointer_initialized()

            # Get LangGraph instance
            graph = get_graph()
            thread_id = str(run_id)
            config = {"configurable": {"thread_id": thread_id}}

            # Initial state
            initial_state: VideoWorkflowState = {
                "run_id": str(run_id),
                "project": run.workflow_name,
                "brief": run.input or "",
                "vector_db_id": vector_db_id,
                "status": RunStatus.RUNNING.value,
                "current_step": "ideation",
            }

            # Invoke LangGraph workflow with durability="sync" for parity/Postgres invocations
            await graph.ainvoke(initial_state, config=config, durability="sync")

            logger.info("LangGraph workflow completed for run %s", run_id)

        except Exception as exc:
            logger.exception("LangGraph workflow failed for run %s: %s", run_id, exc)
            await run_repo.update_async(run_id, status=RunStatus.FAILED.value, error=str(exc))
            await session.commit()


def run_workflow(
    client: LlamaStackClient,
    brief: str,
    vector_db_id: str,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    workflow_name: str = "aismr",
    user_id: Optional[str] = None,
    telegram_chat_id: Optional[str] = None,
) -> WorkflowResult:
    """Execute workflow synchronously using LangGraph (for CLI use).

    This is a sync wrapper around the async LangGraph execution.
    Note: run_repo and artifact_repo are sync repositories for CLI compatibility.
    """
    import anyio

    # Create pending run (sync)
    from storage.database import get_session_factory

    SessionLocal = get_session_factory()
    with SessionLocal() as session:
        sync_run_repo = RunRepository(session)
        run = sync_run_repo.create(
            workflow_name=workflow_name,
            user_id=user_id,
            input=brief,
            status=RunStatus.PENDING,
            telegram_chat_id=telegram_chat_id,
        )
        run_id = run.id
        session.commit()

    # Execute workflow (async, but run in sync context)
    async def _run() -> None:
        await run_workflow_async(
            client=client,
            run_id=run_id,
            vector_db_id=vector_db_id,
        )

    anyio.run(_run)

    # Get final run state (sync)
    with SessionLocal() as session:
        sync_run_repo = RunRepository(session)
        run = sync_run_repo.get(run_id)
        if not run:
            return WorkflowResult(
                run_id=str(run_id),
                status=RunStatus.FAILED.value,
                current_step="unknown",
                error="Run not found after execution",
            )

        return WorkflowResult(
            run_id=str(run_id),
            status=run.status,
            artifacts=run.artifacts or {},
            current_step=run.current_step or "unknown",
            error=run.error,
        )


async def continue_after_ideation(
    run_id: UUID, approved: bool = True, comment: str | None = None
) -> WorkflowResult:
    """Continue workflow after ideation approval using LangGraph resume."""
    from storage.database import get_async_session_factory
    from workflows.langgraph.graph import ensure_checkpointer_initialized

    SessionLocal = get_async_session_factory()

    async with _session_ctx(SessionLocal) as session:
        run_repo = RunRepository(session)

        run = await run_repo.get_async(run_id)
        if not run:
            return WorkflowResult(
                run_id=str(run_id),
                status=RunStatus.FAILED.value,
                current_step="unknown",
                error="Run not found",
            )

        if not settings.database_url.startswith("sqlite"):
            await ensure_checkpointer_initialized()

        graph = get_graph()
        thread_id = str(run_id)
        config = {"configurable": {"thread_id": thread_id}}

        # Resume from ideation_approval node with approval. Prefer targeting the
        # exact pending interrupt (if present) to guarantee the payload reaches
        # ideation_approval_node. Without an interrupt id mapping, LangGraph may
        # ignore the payload when multiple interrupts are pending.
        resume_payload = {"approved": approved, "ideas_approved": approved}
        if comment:
            resume_payload["comment"] = comment

        try:
            graph_state = await graph.aget_state(config)
            interrupts = getattr(graph_state, "interrupts", None) or []
            interrupt_id = None
            if interrupts:
                first_interrupt = interrupts[0]
                interrupt_id = getattr(first_interrupt, "id", None) or getattr(
                    first_interrupt, "interrupt_id", None
                )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("Failed to fetch graph state before resume: %s", exc)
            interrupts = []
            interrupt_id = None

        resume_argument = {interrupt_id: resume_payload} if interrupt_id else resume_payload

        await graph.ainvoke(Command(resume=resume_argument), config=config, durability="sync")

        # Get updated run state
        updated_run = await run_repo.get_async(run_id)
        return WorkflowResult(
            run_id=str(run_id),
            status=updated_run.status if updated_run else RunStatus.FAILED.value,
            artifacts=updated_run.artifacts or {} if updated_run else {},
            current_step=updated_run.current_step or "unknown" if updated_run else "unknown",
            error=updated_run.error if updated_run else None,
        )


async def continue_after_producer(run_id: UUID) -> WorkflowResult:
    """Continue workflow after producer completes (webhook callback).

    This is called from webhook handlers when videos are ready.
    """
    from storage.database import get_async_session_factory

    SessionLocal = get_async_session_factory()

    async with _session_ctx(SessionLocal) as session:
        artifact_repo = ArtifactRepository(session)
        artifacts = await artifact_repo.get_by_run_async(run_id)
        video_clips = sorted_video_clip_urls(artifacts)

        if not video_clips:
            logger.warning("No video clips found for run %s", run_id)
            return WorkflowResult(
                run_id=str(run_id),
                status=RunStatus.FAILED.value,
                current_step="production",
                error="No video clips found",
            )

        from workflows.langgraph.graph import ensure_checkpointer_initialized

        if not settings.database_url.startswith("sqlite"):
            await ensure_checkpointer_initialized()

        graph = get_graph()
        thread_id = str(run_id)
        config = {"configurable": {"thread_id": thread_id}}

        # Resume from the pending interrupt at wait_for_videos with video URLs.
        # Prefer targeting the specific interrupt id so LangGraph applies the payload.
        resume_data = {"video_urls": video_clips, "status": RunStatus.RUNNING.value, "error": None}
        interrupt_id = None
        try:
            graph_state = await graph.aget_state(config)
            interrupts = getattr(graph_state, "interrupts", None) or []
            for intr in interrupts:
                intr_val = getattr(intr, "value", None) or {}
                if isinstance(intr_val, dict) and intr_val.get("waiting_for") == "sora_webhook":
                    interrupt_id = getattr(intr, "id", None) or getattr(
                        intr, "interrupt_id", None
                    )
                    break
            if not interrupt_id:
                raise ValueError(
                    f"No sora_webhook interrupt found for run {run_id}; refusing to resume"
                )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("Failed to fetch graph state before producer resume: %s", exc)
            raise

        resume_argument = {interrupt_id: resume_data}
        await graph.ainvoke(Command(resume=resume_argument), config=config, durability="sync")

        run_repo = RunRepository(session)
        updated_run = await run_repo.get_async(run_id)
        return WorkflowResult(
            run_id=str(run_id),
            status=updated_run.status if updated_run else RunStatus.FAILED.value,
            current_step=updated_run.current_step or "unknown" if updated_run else "unknown",
            error=updated_run.error if updated_run else None,
        )


async def continue_after_render(run_id: UUID, video_url: str) -> WorkflowResult:
    """Continue workflow after render completes (Remotion webhook or poller)."""
    from storage.database import get_async_session_factory

    SessionLocal = get_async_session_factory()

    async with _session_ctx(SessionLocal) as session:
        run_repo = RunRepository(session)

        from workflows.langgraph.graph import ensure_checkpointer_initialized

        if not settings.database_url.startswith("sqlite"):
            await ensure_checkpointer_initialized()

        graph = get_graph()
        thread_id = str(run_id)
        config = {"configurable": {"thread_id": thread_id}}

        resume_data = {"video_url": video_url}
        interrupt_id = None
        try:
            graph_state = await graph.aget_state(config)
            interrupts = getattr(graph_state, "interrupts", None) or []
            for intr in interrupts:
                intr_val = getattr(intr, "value", None) or {}
                if isinstance(intr_val, dict) and intr_val.get("waiting_for") == "remotion_webhook":
                    interrupt_id = getattr(intr, "id", None) or getattr(
                        intr, "interrupt_id", None
                    )
                    break
            if not interrupt_id:
                raise ValueError(
                    f"No remotion_webhook interrupt found for run {run_id}; refusing to resume"
                )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("Failed to fetch graph state before render resume: %s", exc)
            raise

        resume_argument = {interrupt_id: resume_data}
        await graph.ainvoke(Command(resume=resume_argument), config=config, durability="sync")

        updated_run = await run_repo.get_async(run_id)
        return WorkflowResult(
            run_id=str(run_id),
            status=updated_run.status if updated_run else RunStatus.FAILED.value,
            current_step=updated_run.current_step or "unknown" if updated_run else "unknown",
            error=updated_run.error if updated_run else None,
        )


async def continue_after_publish_approval(
    run_id: UUID, approved: bool = True, comment: str | None = None
) -> WorkflowResult:
    """Continue workflow after publish approval using LangGraph resume."""
    from storage.database import get_async_session_factory

    SessionLocal = get_async_session_factory()

    async with _session_ctx(SessionLocal) as session:
        run_repo = RunRepository(session)

        run = await run_repo.get_async(run_id)
        if not run:
            return WorkflowResult(
                run_id=str(run_id),
                status=RunStatus.FAILED.value,
                current_step="unknown",
                error="Run not found",
            )

        from workflows.langgraph.graph import ensure_checkpointer_initialized

        if not settings.database_url.startswith("sqlite"):
            await ensure_checkpointer_initialized()

        graph = get_graph()
        thread_id = str(run_id)
        config = {"configurable": {"thread_id": thread_id}}

        # Resume from publish_approval node with approval decision.
        # publish_approval_node reads `approved`/`comment` from the interrupt payload.
        resume_data: dict[str, Any] = {"approved": approved}
        if comment:
            resume_data["comment"] = comment
        interrupt_id = None
        try:
            graph_state = await graph.aget_state(config)
            interrupts = getattr(graph_state, "interrupts", None) or []
            if interrupts:
                first_interrupt = interrupts[0]
                interrupt_id = getattr(first_interrupt, "id", None) or getattr(
                    first_interrupt, "interrupt_id", None
                )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("Failed to fetch graph state before publish approval resume: %s", exc)

        resume_argument = {interrupt_id: resume_data} if interrupt_id else resume_data
        await graph.ainvoke(Command(resume=resume_argument), config=config, durability="sync")

        # Get updated run state
        updated_run = await run_repo.get_async(run_id)
        return WorkflowResult(
            run_id=str(run_id),
            status=updated_run.status if updated_run else RunStatus.FAILED.value,
            artifacts=updated_run.artifacts or {} if updated_run else {},
            current_step=updated_run.current_step or "unknown" if updated_run else "unknown",
            error=updated_run.error if updated_run else None,
        )


async def continue_after_publish(run_id: UUID, published_urls: list[str]) -> WorkflowResult:
    """Continue workflow after publish completion (poller/webhook)."""
    from storage.database import get_async_session_factory

    SessionLocal = get_async_session_factory()

    async with _session_ctx(SessionLocal) as session:
        run_repo = RunRepository(session)

        from workflows.langgraph.graph import ensure_checkpointer_initialized

        if not settings.database_url.startswith("sqlite"):
            await ensure_checkpointer_initialized()

        graph = get_graph()
        thread_id = str(run_id)
        config = {"configurable": {"thread_id": thread_id}}

        # Target the specific interrupt if present
        resume_data = {"published_urls": published_urls, "publish_complete": True}
        interrupt_id = None
        try:
            graph_state = await graph.aget_state(config)
            interrupts = getattr(graph_state, "interrupts", None) or []
            for intr in interrupts:
                intr_val = getattr(intr, "value", None) or {}
                if isinstance(intr_val, dict) and intr_val.get("waiting_for") == "publish_webhook":
                    interrupt_id = getattr(intr, "id", None) or getattr(
                        intr, "interrupt_id", None
                    )
                    break
            if not interrupt_id:
                raise ValueError(
                    f"No publish_webhook interrupt found for run {run_id}; refusing to resume"
                )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("Failed to fetch graph state before publish resume: %s", exc)
            raise

        resume_argument = {interrupt_id: resume_data}
        await graph.ainvoke(Command(resume=resume_argument), config=config, durability="sync")

        updated_run = await run_repo.get_async(run_id)
        return WorkflowResult(
            run_id=str(run_id),
            status=updated_run.status if updated_run else RunStatus.FAILED.value,
            current_step=updated_run.current_step or "unknown" if updated_run else "unknown",
            error=updated_run.error if updated_run else None,
        )
