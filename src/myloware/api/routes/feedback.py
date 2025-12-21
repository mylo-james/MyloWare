"""Feedback capture endpoints for human ratings on outputs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from myloware.api.dependencies_async import get_async_feedback_repo, get_async_run_repo
from myloware.observability.logging import get_logger
from myloware.storage.repositories import FeedbackRepository, RunRepository

logger = get_logger(__name__)

router = APIRouter(tags=["Feedback"])


class FeedbackRequest(BaseModel):
    """Request to create feedback on a run or artifact."""

    artifact_id: UUID | None = Field(
        default=None,
        description="Optional specific artifact being rated",
    )
    rating: Literal[1, 5] = Field(
        ...,
        description="Rating: 1 (thumbs down) or 5 (thumbs up)",
    )
    comment: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional text feedback",
    )


class FeedbackResponse(BaseModel):
    """Response after creating feedback."""

    id: str
    run_id: str
    artifact_id: str | None
    rating: int
    comment: str | None
    created_at: datetime


class FeedbackListResponse(BaseModel):
    """Response listing feedback for a run."""

    feedback: list[FeedbackResponse]
    count: int


@router.post(
    "/runs/{run_id}/feedback",
    response_model=FeedbackResponse,
    status_code=201,
    summary="Submit feedback on a run",
    description="Submit thumbs-up (5) or thumbs-down (1) feedback on a workflow run.",
)
async def create_feedback(
    run_id: UUID,
    request: FeedbackRequest,
    run_repo: RunRepository = Depends(get_async_run_repo),
    feedback_repo: FeedbackRepository = Depends(get_async_feedback_repo),
) -> FeedbackResponse:
    """Create feedback for a workflow run.

    Args:
        run_id: UUID of the run to rate
        request: Feedback details (rating, optional artifact_id, optional comment)

    Returns:
        Created feedback record

    Raises:
        404: Run not found
    """
    # Verify run exists
    run = await run_repo.get_async(run_id)
    if not run:
        logger.warning("feedback_run_not_found", run_id=str(run_id))
        raise HTTPException(status_code=404, detail="Run not found")

    # Create feedback
    feedback = await feedback_repo.create_async(
        run_id=run_id,
        artifact_id=request.artifact_id,
        rating=request.rating,
        comment=request.comment,
    )
    await feedback_repo.session.commit()

    logger.info(
        "feedback_created",
        run_id=str(run_id),
        feedback_id=str(feedback.id),
        rating=request.rating,
    )

    return FeedbackResponse(
        id=str(feedback.id),
        run_id=str(feedback.run_id),
        artifact_id=str(feedback.artifact_id) if feedback.artifact_id else None,
        rating=feedback.rating,
        comment=feedback.comment,
        created_at=feedback.created_at,
    )


@router.get(
    "/runs/{run_id}/feedback",
    response_model=FeedbackListResponse,
    summary="Get feedback for a run",
    description="Retrieve all feedback submitted for a specific run.",
)
async def get_run_feedback(
    run_id: UUID,
    run_repo: RunRepository = Depends(get_async_run_repo),
    feedback_repo: FeedbackRepository = Depends(get_async_feedback_repo),
) -> FeedbackListResponse:
    """Get all feedback for a run.

    Args:
        run_id: UUID of the run

    Returns:
        List of feedback entries

    Raises:
        404: Run not found
    """
    # Verify run exists
    run = await run_repo.get_async(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    feedback_list = await feedback_repo.get_by_run_id_async(run_id)

    return FeedbackListResponse(
        feedback=[
            FeedbackResponse(
                id=str(f.id),
                run_id=str(f.run_id),
                artifact_id=str(f.artifact_id) if f.artifact_id else None,
                rating=f.rating,
                comment=f.comment,
                created_at=f.created_at,
            )
            for f in feedback_list
        ],
        count=len(feedback_list),
    )
