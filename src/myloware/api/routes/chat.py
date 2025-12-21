"""Supervisor chat endpoint."""

from __future__ import annotations

from typing import Optional, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from llama_stack_client import AsyncLlamaStackClient, LlamaStackClient
from pydantic import BaseModel, Field
from slowapi import Limiter
from fastapi.responses import StreamingResponse
import asyncio

from myloware.api.rate_limit import key_api_key_or_ip
from myloware.api.schemas import ChatResponseModel, ErrorResponse
from myloware.backends import LlamaStackBackend

from myloware.api.dependencies import (
    get_chat_session_repo,
    get_llama_client,
    get_async_llama_client,
    get_vector_db_id,
)
from myloware.agents.classifier import (
    ClassificationResult,
    classify_request,
    classify_request_async,
)
from myloware.agents.supervisor import create_supervisor_agent
from myloware.memory.preferences import extract_and_store_preference
from myloware.observability.logging import get_logger
from myloware.storage.repositories import ChatSessionRepository
from myloware.workflows.langgraph.agent_io import (
    create_turn_collecting_tool_responses,
    extract_content,
)
from fastapi.concurrency import run_in_threadpool

router = APIRouter(prefix="/v1/chat", tags=["chat"])
logger = get_logger(__name__)

# Rate limiter for chat endpoints
limiter = Limiter(key_func=key_api_key_or_ip)


class ChatRequest(BaseModel):
    user_id: str
    message: str


class ChatResponse(BaseModel):
    response: str
    run_id: Optional[str] = None
    actions_taken: list[str] = Field(default_factory=list)


@router.post(
    "/supervisor", response_model=ChatResponseModel, responses={500: {"model": ErrorResponse}}
)
@limiter.limit("30/minute")
async def chat_with_supervisor(
    request: Request,
    body: ChatRequest,
    client: LlamaStackClient = Depends(get_llama_client),
    async_client: AsyncLlamaStackClient = Depends(get_async_llama_client),
    session_repo: ChatSessionRepository = Depends(get_chat_session_repo),
    vector_db_id: str = Depends(get_vector_db_id),
    stream: bool = False,
) -> ChatResponseModel:
    """Chat with Supervisor supervisor agent."""

    def _extract_run_id(tool_responses: list[dict[str, object]]) -> str | None:
        import json

        for payload in tool_responses:
            tool_name = payload.get("tool_name") or payload.get("name")
            if tool_name != "start_workflow":
                continue
            content = payload.get("content")
            data = None
            if isinstance(content, dict):
                data = content
            elif isinstance(content, str):
                try:
                    data = json.loads(content)
                except Exception:
                    data = None
            if isinstance(data, dict) and data.get("run_id"):
                return str(data["run_id"])
        return None

    try:
        backend = LlamaStackBackend(sync_client=client, async_client=async_client)
        try:
            _ = extract_and_store_preference(client, body.user_id, body.message)
        except AttributeError:
            # Llama Stack client may not expose memory in fake/test environments
            logger.debug("Memory API not available on client; skipping preference storage")

        # Prefer async classification to keep loop non-blocking
        try:
            classification: ClassificationResult = await classify_request_async(
                backend, body.message
            )
        except Exception:
            # Fallback to sync classification if async fails
            classification = await run_in_threadpool(classify_request, backend, body.message)

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

        # Non-streaming: use supervisor agent (sync, wrapped in threads)
        if not stream:
            agent = await run_in_threadpool(create_supervisor_agent, client, None, vector_db_id)

            # Create fresh session for this request
            session_id = await run_in_threadpool(
                agent.create_session,
                f"user-{body.user_id}-{request.state._id if hasattr(request.state, '_id') else 'new'}",
            )
            logger.info("Created fresh session: %s", session_id)

            try:
                response, tool_responses = await run_in_threadpool(
                    create_turn_collecting_tool_responses,
                    agent,
                    [{"role": "user", "content": augmented_message}],
                    session_id,
                )
                text = extract_content(response) if response is not None else ""
                run_id = _extract_run_id(tool_responses)

                if not run_id:
                    logger.error(
                        "Supervisor response missing run_id",
                        extra={"request_id": getattr(request.state, "_id", None)},
                    )
                    raise HTTPException(
                        status_code=500,
                        detail="Supervisor did not return a run_id; aborting to avoid silent failures.",
                    )

                return ChatResponse(response=text, run_id=run_id)
            finally:
                # Clean up session (official Llama Stack pattern)
                try:
                    await run_in_threadpool(client.conversations.delete, conversation_id=session_id)
                    logger.debug("Cleaned up session: %s", session_id)
                except Exception as cleanup_exc:
                    logger.warning("Failed to cleanup session %s: %s", session_id, cleanup_exc)

        # Streaming path: use async chat completions with backpressure queue
        async def stream_chunks() -> AsyncIterator[str]:
            queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=100)

            async def producer():
                try:
                    async for chunk in async_client.chat.completions.create(
                        model=(classification.model if hasattr(classification, "model") else None)
                        or getattr(request.app.state, "default_model", None)
                        or "meta-llama/Llama-3.2-3B-Instruct",
                        messages=[{"role": "user", "content": augmented_message}],
                        stream=True,
                    ):
                        content = None
                        if hasattr(chunk, "choices") and chunk.choices:
                            delta = getattr(chunk.choices[0], "delta", None)
                            content = getattr(delta, "content", None) if delta else None
                            if not content:
                                msg = getattr(chunk.choices[0], "message", None)
                                content = getattr(msg, "content", None) if msg else None
                        if content:
                            await queue.put(content)
                except Exception as exc:
                    await queue.put(f"[stream-error] {exc}")
                finally:
                    await queue.put(None)

            producer_task = asyncio.create_task(producer())

            while True:
                if await request.is_disconnected():
                    producer_task.cancel()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    # Keep-alive comment for SSE
                    yield ":keepalive\n\n"
                    continue
                if item is None:
                    break
                # SSE format
                yield f"data: {item}\n\n"

        return StreamingResponse(stream_chunks(), media_type="text/event-stream")
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Chat with Supervisor failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
