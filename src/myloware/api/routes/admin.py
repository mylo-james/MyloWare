"""Admin endpoints for system management."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import anyio

from myloware.config import settings
from myloware.knowledge.loader import load_documents_with_manifest
from myloware.knowledge.setup import setup_project_knowledge
from myloware.llama_clients import get_sync_client

from myloware.api.dependencies import verify_api_key
from myloware.api.schemas import ErrorResponse
from myloware.observability.logging import get_logger
from myloware.storage.database import get_async_session_factory
from myloware.storage.repositories import DeadLetterRepository

logger = get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(verify_api_key)])


class DeadLetterListItem(BaseModel):
    """Dead letter queue entry for list view."""

    id: str
    source: str
    run_id: str
    error: str | None
    attempts: int
    created_at: str
    last_attempt_at: str | None
    resolved_at: str | None


class DeadLetterListResponse(BaseModel):
    """Response for dead letter list."""

    dead_letters: list[DeadLetterListItem]
    count: int


class DeadLetterDetailResponse(BaseModel):
    """Response for dead letter detail."""

    id: str
    source: str
    run_id: str
    payload: dict[str, Any]
    error: str | None
    attempts: int
    created_at: str
    last_attempt_at: str | None
    resolved_at: str | None


@router.get(
    "/dlq",
    response_model=DeadLetterListResponse,
    responses={500: {"model": ErrorResponse}},
)
async def list_dead_letters(
    request: Request,
    source: str | None = None,
    unresolved_only: bool = True,
) -> DeadLetterListResponse:
    """List dead letter queue entries.

    Args:
        source: Optional filter by source ("sora", "remotion")
        unresolved_only: If True, only return unresolved entries

    Returns:
        List of dead letter entries
    """
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        dlq_repo = DeadLetterRepository(session)

        try:
            if unresolved_only:
                dead_letters = await dlq_repo.get_unresolved_async(source=source)
            else:
                from myloware.storage.models import DeadLetter
                from sqlalchemy import select

                query = select(DeadLetter)
                if source:
                    query = query.where(DeadLetter.source == source)
                query = query.order_by(DeadLetter.created_at.desc())
                result = await session.execute(query)
                dead_letters = result.scalars().all()

            items = [
                DeadLetterListItem(
                    id=str(dl.id),
                    source=dl.source,
                    run_id=str(dl.run_id),
                    error=dl.error,
                    attempts=dl.attempts,
                    created_at=dl.created_at.isoformat() if dl.created_at else "",
                    last_attempt_at=dl.last_attempt_at.isoformat() if dl.last_attempt_at else None,
                    resolved_at=dl.resolved_at.isoformat() if dl.resolved_at else None,
                )
                for dl in dead_letters
            ]

            return DeadLetterListResponse(dead_letters=items, count=len(items))

        except Exception as exc:
            logger.exception("Failed to list dead letters: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to list dead letters: {str(exc)}")


@router.get(
    "/dlq/{dead_letter_id}",
    response_model=DeadLetterDetailResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def get_dead_letter(
    request: Request,
    dead_letter_id: str,
) -> DeadLetterDetailResponse:
    """Get a specific dead letter entry.

    Args:
        dead_letter_id: ID of the dead letter entry

    Returns:
        Dead letter details including full payload
    """
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        dlq_repo = DeadLetterRepository(session)

        try:
            dead_letter = await dlq_repo.get_async(UUID(dead_letter_id))
            if not dead_letter:
                raise HTTPException(
                    status_code=404, detail=f"Dead letter {dead_letter_id} not found"
                )

            return DeadLetterDetailResponse(
                id=str(dead_letter.id),
                source=dead_letter.source,
                run_id=str(dead_letter.run_id),
                payload=dead_letter.payload,
                error=dead_letter.error,
                attempts=dead_letter.attempts,
                created_at=dead_letter.created_at.isoformat() if dead_letter.created_at else "",
                last_attempt_at=(
                    dead_letter.last_attempt_at.isoformat() if dead_letter.last_attempt_at else None
                ),
                resolved_at=(
                    dead_letter.resolved_at.isoformat() if dead_letter.resolved_at else None
                ),
            )

        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Failed to get dead letter: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to get dead letter: {str(exc)}")


@router.post(
    "/dlq/{dead_letter_id}/replay",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def replay_dead_letter(
    request: Request,
    dead_letter_id: str,
) -> dict[str, Any]:
    """Replay a dead letter entry by re-processing the webhook.

    This will attempt to process the stored webhook payload again,
    which may trigger the workflow continuation if the underlying issue is resolved.

    Args:
        dead_letter_id: ID of the dead letter entry to replay

    Returns:
        Status of replay operation
    """
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        dlq_repo = DeadLetterRepository(session)

        try:
            dead_letter = await dlq_repo.get_async(UUID(dead_letter_id))
            if not dead_letter:
                raise HTTPException(
                    status_code=404, detail=f"Dead letter {dead_letter_id} not found"
                )

            if dead_letter.resolved_at:
                raise HTTPException(
                    status_code=400, detail=f"Dead letter {dead_letter_id} is already resolved"
                )

            result = await _replay_dead_letter(dead_letter)
            await dlq_repo.mark_resolved_async(dead_letter.id)
            await session.commit()
            return result

        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Failed to replay dead letter: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to replay dead letter: {str(exc)}")


async def _replay_dead_letter(dead_letter) -> dict[str, Any]:
    """Internal helper to replay a dead letter payload."""
    from myloware.workflows.dlq_replay import replay_dead_letter

    try:
        return await replay_dead_letter(dead_letter)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/dlq/{dead_letter_id}/resolve",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
async def resolve_dead_letter(
    request: Request,
    dead_letter_id: str,
) -> dict[str, Any]:
    """Mark a dead letter as resolved.

    This is useful when a dead letter has been manually handled
    or is no longer relevant.

    Args:
        dead_letter_id: ID of the dead letter entry to resolve

    Returns:
        Status of resolution
    """
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        dlq_repo = DeadLetterRepository(session)

        try:
            dead_letter = await dlq_repo.get_async(UUID(dead_letter_id))
            if not dead_letter:
                raise HTTPException(
                    status_code=404, detail=f"Dead letter {dead_letter_id} not found"
                )

            if dead_letter.resolved_at:
                return {
                    "status": "already_resolved",
                    "dead_letter_id": dead_letter_id,
                    "resolved_at": dead_letter.resolved_at.isoformat(),
                }

            await dlq_repo.mark_resolved_async(dead_letter.id)
            await session.commit()

            logger.info("Dead letter %s marked as resolved", dead_letter_id)

            return {
                "status": "resolved",
                "dead_letter_id": dead_letter_id,
            }

        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Failed to resolve dead letter: %s", exc)
            raise HTTPException(
                status_code=500, detail=f"Failed to resolve dead letter: {str(exc)}"
            )


@router.post("/kb/reload")
async def reload_knowledge_base() -> dict[str, Any]:
    """Reload knowledge base on-demand (honors unchanged manifest)."""

    # KB setup uses sync client internally; wrap in thread to avoid blocking if called from async context
    client = await anyio.to_thread.run_sync(get_sync_client)
    project_id = settings.project_id
    documents, manifest = load_documents_with_manifest(
        project_id, include_global=True, read_content=True
    )

    vector_db_id = await anyio.to_thread.run_sync(
        setup_project_knowledge,
        client,
        project_id,
        documents if documents else None,
    )

    return {
        "status": "reloaded",
        "vector_db_id": vector_db_id,
        "doc_count": len(documents),
        "manifest_hash": manifest.get("hash"),
    }
