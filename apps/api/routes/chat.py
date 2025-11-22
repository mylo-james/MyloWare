"""Chat proxy endpoints for Brendan."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from ..auth import verify_api_key
from ..rate_limiter import rate_limit_dependency
from ..deps import get_orchestrator_client
from ..orchestrator_client import OrchestratorClient

router = APIRouter(prefix="/v1/chat", tags=["chat"], dependencies=[Depends(verify_api_key)])


class ChatRequest(BaseModel):
    user_id: str = Field(..., description="Conversation thread id (usually user id)")
    message: str = Field(..., description="User message to Brendan")


class ChatResponse(BaseModel):
    response: str
    run_ids: list[str] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)


@router.post(
    "/brendan",
    response_model=ChatResponse,
    dependencies=[Depends(rate_limit_dependency("chat_brendan"))],
)
async def chat_with_brendan(
    payload: ChatRequest,
    orchestrator: Annotated[OrchestratorClient, Depends(get_orchestrator_client)],
) -> ChatResponse:
    """Forward chat requests to the orchestrator's Brendan endpoint."""
    response = await run_in_threadpool(
        orchestrator.chat_brendan,
        user_id=payload.user_id,
        message=payload.message,
    )
    return ChatResponse(**response)
