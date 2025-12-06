"""Supervisor chat endpoint."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.dependencies import get_chat_session_repo, get_llama_client
from agents.supervisor import create_supervisor_agent
from agents.classifier import (
    ClassificationResult,
    classify_request,
)
from client import extract_content
from memory.preferences import extract_and_store_preference
from storage.repositories import ChatSessionRepository

router = APIRouter(prefix="/v1/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# Rate limiter for chat endpoints
limiter = Limiter(key_func=get_remote_address)


class ChatRequest(BaseModel):
    user_id: str
    message: str


class ChatResponse(BaseModel):
    response: str
    run_id: Optional[str] = None
    actions_taken: list[str] = []


@router.post("/supervisor", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat_with_supervisor(
    request: Request,
    body: ChatRequest,
    client=Depends(get_llama_client),
    session_repo: ChatSessionRepository = Depends(get_chat_session_repo),
) -> ChatResponse:
    """Chat with Supervisor supervisor agent."""

    try:
        _ = extract_and_store_preference(client, body.user_id, body.message)

        classification: ClassificationResult = classify_request(client, body.message)

        logger.info(
            "Request classified",
            extra={
                "user_id": body.user_id,
                "intent": classification.intent,
                "project": classification.project,
                "confidence": classification.confidence,
            },
        )

        context_parts = [f"[intent={classification.intent} conf={classification.confidence:.2f}]"]
        if classification.project:
            context_parts.append(f"[project={classification.project}]")
        if classification.run_id:
            context_parts.append(f"[run_id={classification.run_id}]")
        if classification.gate:
            context_parts.append(f"[gate={classification.gate}]")
        if classification.custom_object:
            context_parts.append(f"[object={classification.custom_object}]")

        context_str = " ".join(context_parts)
        augmented_message = f"{context_str}\n\n{body.message}" if context_parts else body.message

        agent = create_supervisor_agent(client)
        
        # Get or create session - always create fresh to avoid stale session issues
        # When Llama Stack restarts, old sessions become invalid
        session_id = agent.create_session(f"user-{body.user_id}-{request.state._id if hasattr(request.state, '_id') else 'new'}")
        logger.info("Created fresh session: %s", session_id)

        response = agent.create_turn(
            messages=[{"role": "user", "content": augmented_message}],
            session_id=session_id,
        )

        # Handle streaming generator response from agent.create_turn()
        text = extract_content(response)

        return ChatResponse(response=text, run_id=None, actions_taken=[])
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Chat with Supervisor failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
