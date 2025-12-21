"""Postgres-backed worker loop."""

from __future__ import annotations

import os
import socket
from uuid import UUID

import asyncio
import anyio

from myloware.config import settings
from myloware.llama_clients import get_sync_client
from myloware.observability.logging import get_logger
from myloware.storage.database import get_async_session_factory
from myloware.storage.models import Job, JobStatus
from myloware.storage.repositories import (
    ArtifactRepository,
    DeadLetterRepository,
    JobRepository,
    RunRepository,
)
from myloware.workers.exceptions import JobReschedule
from myloware.workers.handlers import handle_job

logger = get_logger(__name__)


def _default_worker_id() -> str:
    host = socket.gethostname()
    pid = os.getpid()
    return f"{host}:{pid}"


async def _lease_heartbeat(
    job_id: UUID, worker_id: str, lease_seconds: float, stop_event: anyio.Event
) -> None:
    """Periodically extend the lease for a running job.

    Uses a separate DB session to avoid committing partial side effects from the
    job execution session.
    """
    interval_seconds = max(1.0, min(float(lease_seconds) / 3.0, 30.0))
    SessionLocal = get_async_session_factory()
    while True:
        with anyio.move_on_after(interval_seconds):
            await stop_event.wait()
        if stop_event.is_set():
            return
        try:
            async with SessionLocal() as hb_session:
                hb_repo = JobRepository(hb_session)
                await hb_repo.touch_lease_async(
                    job_id,
                    worker_id=worker_id,
                    lease_seconds=float(lease_seconds),
                )
                await hb_session.commit()
        except Exception:
            logger.warning("job_lease_renew_failed", job_id=str(job_id), exc_info=True)


async def _process_one_job(job_id: UUID, worker_id: str, *, lease_seconds: float) -> None:
    """Execute one claimed job and mark succeeded/failed."""
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        job_repo = JobRepository(session)
        run_repo = RunRepository(session)
        artifact_repo = ArtifactRepository(session)
        dlq_repo = DeadLetterRepository(session)

        from sqlalchemy import select

        job_result = await session.execute(select(Job).where(Job.id == job_id))
        job = job_result.scalar_one_or_none()
        if job is None:
            return

        job_type = str(job.job_type)
        run_id = job.run_id
        payload = dict(job.payload or {})

        llama_client = get_sync_client()

        stop_event = anyio.Event()
        handler_exc: Exception | None = None
        async with anyio.create_task_group() as tg:
            tg.start_soon(_lease_heartbeat, job_id, worker_id, float(lease_seconds), stop_event)
            try:
                await handle_job(
                    job_type=job_type,
                    run_id=run_id,
                    payload=payload,
                    session_run_repo=run_repo,
                    session_artifact_repo=artifact_repo,
                    session_job_repo=job_repo,
                    llama_client=llama_client,
                )
            except Exception as exc:
                handler_exc = exc
            finally:
                stop_event.set()

        if handler_exc is None:
            await job_repo.mark_succeeded_async(job_id)
            await session.commit()
            logger.info("job_succeeded", job_id=str(job_id), job_type=job_type)
            return

        # Rescheduled: treat as expected control flow (no stacktrace, no DLQ).
        if isinstance(handler_exc, JobReschedule):
            try:
                await session.rollback()
            except Exception:
                logger.warning("job_failure_rollback_failed", job_id=str(job_id), exc_info=True)

            status = await job_repo.mark_failed_async(
                job_id,
                error=str(handler_exc.reason),
                retry_delay_seconds=float(handler_exc.retry_delay_seconds),
            )
            await session.commit()

            if status == JobStatus.FAILED:
                logger.warning(
                    "job_reschedule_exhausted",
                    job_id=str(job_id),
                    job_type=job_type,
                    attempts=int(job.attempts or 0),
                    max_attempts=int(job.max_attempts or 0),
                    error=str(handler_exc.reason),
                )
            else:
                logger.info(
                    "job_rescheduled",
                    job_id=str(job_id),
                    job_type=job_type,
                    retry_delay_seconds=float(handler_exc.retry_delay_seconds),
                    reason=str(handler_exc.reason),
                )
            return

        # Failed: rollback any partial/failed transaction, then retry with backoff.
        try:
            await session.rollback()
        except Exception:
            logger.warning("job_failure_rollback_failed", job_id=str(job_id), exc_info=True)

        delay = float(settings.job_retry_delay_seconds) * max(1.0, float(job.attempts or 1))
        status = await job_repo.mark_failed_async(
            job_id, error=str(handler_exc), retry_delay_seconds=delay
        )
        if status == JobStatus.FAILED:
            if job_type.startswith("webhook.") and run_id is not None:
                try:
                    source = "sora" if job_type.endswith("sora") else "remotion"
                    await dlq_repo.create_async(
                        source=source,
                        run_id=run_id,
                        payload={"job_type": job_type, "payload": payload},
                        error=str(handler_exc),
                        attempts=int(job.attempts or 0),
                    )
                except Exception:
                    logger.warning("dlq_write_failed", job_id=str(job_id), exc_info=True)
        await session.commit()
        logger.warning(
            "job_failed",
            job_id=str(job_id),
            job_type=job_type,
            attempts=int(job.attempts or 0),
            max_attempts=int(job.max_attempts or 0),
            error=str(handler_exc),
            exc_info=handler_exc,
        )


async def run_worker(*, once: bool = False) -> None:
    """Run the worker event loop.

    Args:
        once: If true, process at most one job and exit (useful for tests/ops).
    """
    if settings.disable_background_workflows:
        raise RuntimeError("Worker cannot run with DISABLE_BACKGROUND_WORKFLOWS=true")

    # Explicit LangGraph engine lifecycle for this worker process.
    if settings.use_langgraph_engine:
        from myloware.workflows.langgraph.graph import LangGraphEngine, set_langgraph_engine

        engine = LangGraphEngine()
        set_langgraph_engine(engine)
        if not settings.database_url.startswith("sqlite"):
            await engine.ensure_checkpointer_initialized()

    worker_id = settings.worker_id or _default_worker_id()
    concurrency = max(1, int(settings.worker_concurrency or 1))
    lease_seconds = float(settings.job_lease_seconds)
    poll_interval = float(settings.job_poll_interval_seconds)

    logger.info(
        "worker_start",
        worker_id=worker_id,
        concurrency=concurrency,
        lease_seconds=lease_seconds,
        poll_interval=poll_interval,
    )

    limiter = anyio.Semaphore(concurrency)

    async def _claim_job() -> UUID | None:
        try:
            SessionLocal = get_async_session_factory()
            async with SessionLocal() as session:
                job_repo = JobRepository(session)
                job = await job_repo.claim_next_async(
                    worker_id=worker_id, lease_seconds=lease_seconds
                )
                await session.commit()
                return job.id if job else None
        except Exception:
            logger.warning("job_claim_failed", exc_info=True)
            return None

    async def _run_claimed(jid: UUID) -> None:
        try:
            await _process_one_job(jid, worker_id, lease_seconds=lease_seconds)
        except BaseException as exc:
            if isinstance(exc, asyncio.CancelledError):
                raise
            logger.error("job_unhandled_exception", job_id=str(jid), exc_info=True)
            try:
                SessionLocal = get_async_session_factory()
                async with SessionLocal() as session:
                    job_repo = JobRepository(session)
                    delay = float(settings.job_retry_delay_seconds)
                    await job_repo.mark_failed_async(jid, error=str(exc), retry_delay_seconds=delay)
                    await session.commit()
            except Exception:
                logger.error(
                    "job_unhandled_exception_mark_failed_failed",
                    job_id=str(jid),
                    exc_info=True,
                )
        finally:
            limiter.release()

    if once:
        jid = await _claim_job()
        if jid is None:
            return
        await _process_one_job(jid, worker_id, lease_seconds=lease_seconds)
        return

    async with anyio.create_task_group() as tg:
        while True:
            await limiter.acquire()
            jid = await _claim_job()
            if jid is None:
                limiter.release()
                await anyio.sleep(poll_interval)
                continue
            tg.start_soon(_run_claimed, jid)
