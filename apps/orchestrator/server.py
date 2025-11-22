"""LangGraph Orchestrator ASGI server."""
from __future__ import annotations

# mypy: ignore-errors

import logging
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from langgraph.types import Command

from .auth import verify_api_key
from .checkpointer import PostgresCheckpointer
from .config import settings
from .langgraph_checkpoint import get_graph_checkpointer
from .langsmith_tracing import end_langsmith_run, start_langsmith_run
from .run_state import RunState
from .graph_factory import build_project_graph, load_project_spec
from .supervisor.graph import compile_supervisor_graph
from .supervisor.state import ConversationState
from .observability import setup_observability
from .startup import lifespan
from adapters.observability.request_id import RequestIDMiddleware, get_request_id

logger = logging.getLogger("myloware.orchestrator.server")

app = FastAPI(title="MyloWare Orchestrator", version=settings.version, lifespan=lifespan)
app.add_middleware(RequestIDMiddleware)

_brendan_graph: Any | None = None
_project_graphs: dict[str, Any] = {}


def _ensure_brendan_graph() -> Any:
    """Return a cached Brendan supervisor graph, compiling it once."""
    global _brendan_graph
    if _brendan_graph is None:
        checkpointer = _get_checkpointer()
        _brendan_graph = compile_supervisor_graph(checkpointer)
    return _brendan_graph


def _get_or_build_project_graph(project: str) -> Any:
    """Get or build a cached compiled graph for a project.
    
    CRITICAL: We must reuse the same compiled graph instance across invocations
    so that LangGraph checkpoints are preserved. If we rebuild the graph each time,
    the checkpointer loses track of interrupted state and the graph restarts from START.
    """
    global _project_graphs
    if project not in _project_graphs:
        project_spec = load_project_spec(project)
        graph_builder = build_project_graph(project_spec, project)
        # Use LangGraph's native PostgresSaver for Command(resume=...) support
        _project_graphs[project] = graph_builder.compile(checkpointer=get_graph_checkpointer())
        logger.info(f"Built and cached graph for project '{project}'")
    return _project_graphs[project]

setup_observability(app, settings)


class VideoSpec(BaseModel):
    subject: str
    header: str


class RunPayload(BaseModel):
    project: str
    input: str | None = None
    videos: list[VideoSpec] = Field(default_factory=list)
    model: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    resume: dict[str, Any] | None = None


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "timestamp": datetime.now(UTC).isoformat(),
        "request_id": get_request_id(),
    }


@app.post("/runs/{run_id}", dependencies=[Depends(verify_api_key)], tags=["runs"])
async def run_once(run_id: str, payload: RunPayload, background: bool = False) -> dict[str, object]:
    """Invoke production graph and persist checkpoints.
    
    If background=true, starts execution asynchronously and returns immediately.
    """

    # Get or build cached graph for this project. CRITICAL: We must reuse the same
    # compiled graph instance so that LangGraph checkpoints are preserved across
    # invocations. If we rebuild the graph each time, interrupts don't work correctly.
    graph = _get_or_build_project_graph(payload.project)

    # LangGraph's PostgresSaver is the canonical checkpoint store for production graphs.
    # Build incoming state for ALL invocations - LangGraph merges it with checkpoint on resume.
    project_spec = load_project_spec(payload.project)
    metadata = dict(payload.metadata or {})
    options = dict(metadata.get("options") or {})
    incoming: RunState = {
        "run_id": run_id,
        "project": payload.project,
        "project_spec": project_spec,
        "input": payload.input or "",
        "videos": [video.model_dump() for video in payload.videos],
        "totalVideos": len(payload.videos),
        "metadata": metadata,
        "options": options,
    }
    if payload.model is not None:
        incoming["model"] = payload.model
    
    if background:
        # Start execution in background
        import asyncio
        asyncio.create_task(_execute_graph_async(
            graph=graph,
            run_id=run_id,
            incoming=incoming,
            resume=payload.resume,
            project=payload.project,
        ))
        return {"run_id": run_id, "status": "started"}

    else:
        # Synchronous execution (for testing)
        langsmith_run = start_langsmith_run(
            name=f"{payload.project}-graph",
            inputs={"run_id": run_id, "project": payload.project, "resume": bool(payload.resume)},
            tags=["graph", payload.project, run_id],
            metadata={"run_id": run_id, "project": payload.project},
        )
        try:
            config = {"configurable": {"thread_id": run_id}}
            if payload.resume is not None:
                logger.info(
                    "Resuming graph from checkpoint (sync)",
                    extra={"run_id": run_id, "resume_keys": list((payload.resume or {}).keys())},
                )
                resume_value = dict(payload.resume)
                result_state = graph.invoke(Command(resume=resume_value), config=config)
            else:
                # Initial run: pass the constructed incoming state
                invoke_state = dict(incoming)
                if langsmith_run is not None:
                    invoke_state["_langsmith_run"] = langsmith_run
                result_state = graph.invoke(invoke_state, config=config)
            if langsmith_run is not None and isinstance(result_state, dict):
                result_state.pop("_langsmith_run", None)
            end_langsmith_run(langsmith_run, outputs=_summarize_state(result_state))
        except Exception as exc:
            end_langsmith_run(langsmith_run, error=str(exc))
            logger.exception(
                "Graph execution failed",
                extra={"run_id": run_id, "project": payload.project},
            )
            raise HTTPException(
                status_code=500,
                detail=f"graph execution failed: {exc}",
            ) from exc
        _handle_run_notification(run_id, payload.project, result_state)
        return {"run_id": run_id, "state": result_state}


async def _execute_graph_async(
    graph: Any,
    run_id: str,
    incoming: RunState | None,
    resume: dict[str, Any] | None,
    project: str,
) -> None:
    """Execute graph asynchronously in background.
    
    Args:
        incoming: Initial state for new runs, or None for resumes (checkpoint loads state)
        resume: Resume payload if resuming from interrupt, None for initial runs
    """
    import asyncio
    loop = asyncio.get_event_loop()
    
    try:
        langsmith_run = start_langsmith_run(
            name=f"{project}-graph",
            inputs={"run_id": run_id, "project": project, "resume": bool(resume)},
            tags=["graph", str(project), run_id],
            metadata={"run_id": run_id, "project": project},
        )
        # Run blocking invoke in executor
        config = {"configurable": {"thread_id": run_id}}

        def _invoke_with_state(state: RunState) -> RunState:
            return graph.invoke(state, config=config)

        if resume is not None:
            def _resume_call() -> RunState:
                resume_value = dict(resume)
                logger.info(
                    "Resuming graph from checkpoint (async)",
                    extra={"run_id": run_id, "resume_keys": list(resume_value.keys())},
                )
                return graph.invoke(Command(resume=resume_value), config=config)

            result_state = await loop.run_in_executor(None, _resume_call)
        else:
            # Initial run: pass the constructed incoming state
            if incoming is None:
                raise ValueError("incoming state required for initial run")
            def _invoke_call() -> RunState:
                invoke_state = dict(incoming)
                if langsmith_run is not None:
                    invoke_state["_langsmith_run"] = langsmith_run
                return _invoke_with_state(invoke_state)

            result_state = await loop.run_in_executor(None, _invoke_call)
        if langsmith_run is not None and isinstance(result_state, dict):
            result_state.pop("_langsmith_run", None)
        end_langsmith_run(langsmith_run, outputs=_summarize_state(result_state))
        if result_state.get("__interrupt__"):
            logger.info("Graph awaiting HITL approval", extra={"run_id": run_id, "project": project, "gate": result_state.get("awaiting_gate")})
        else:
            logger.info("Graph execution completed", extra={"run_id": run_id, "project": project})
        _handle_run_notification(run_id, project, result_state)
    except Exception as exc:
        logger.error("Graph execution failed", exc_info=exc, extra={"run_id": run_id})
        end_langsmith_run(langsmith_run, error=str(exc))


def _handle_run_notification(run_id: str, project: str | None, result_state: RunState) -> None:
    gate = result_state.get("awaiting_gate")
    if result_state.get("__interrupt__") and gate:
        message = f"Run {run_id} is waiting on {gate} approval."
        _send_notification(run_id, notification_type=f"awaiting_{gate}", message=message, gate=gate, project=project)
        return
    if not result_state.get("__interrupt__"):
        message = f"Run {run_id} completed successfully."
        _send_notification(run_id, notification_type="completed", message=message, gate=None, project=project)


def _send_notification(
    run_id: str,
    *,
    notification_type: str,
    message: str,
    gate: str | None,
    project: str | None,
) -> None:
    api_base = settings.api_base_url.rstrip("/")
    try:
        httpx.post(
            f"{api_base}/v1/notifications/graph/{run_id}",
            json={
                "notification_type": notification_type,
                "message": message,
                "gate": gate,
                "project": project,
            },
            headers={"x-api-key": settings.api_key},
            timeout=5.0,
        )
    except Exception as exc:  # pragma: no cover - notification failures shouldn't break runs
        logger.warning(
            "Failed to send notification",
            extra={"run_id": run_id, "type": notification_type, "error": str(exc)},
        )


@lru_cache(maxsize=1)
def _get_checkpointer() -> PostgresCheckpointer:
    return PostgresCheckpointer(settings.db_url)



class ChatRequest(BaseModel):
    user_id: str
    message: str


class ChatResponse(BaseModel):
    response: str
    run_ids: list[str] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)


def _handle_chat(request: ChatRequest) -> ChatResponse:
    """Chat with Brendan - conversational orchestrator.
    
    Uses user_id as thread_id for persistent conversation history.
    """
    checkpointer = _get_checkpointer()
    brendan_graph = _ensure_brendan_graph()
    
    # Load conversation state
    thread_id = request.user_id
    prior_state = checkpointer.load(thread_id) or {}
    
    # Prepare state
    conversation_state: ConversationState = {
        "user_id": request.user_id,
        "messages": prior_state.get("messages", []),
        "current_message": request.message,
        "response": "",
        "run_ids": prior_state.get("run_ids", []),
        "retrieval_traces": prior_state.get("retrieval_traces", []),
        "citations": prior_state.get("citations", []),
        "pending_gate": prior_state.get("pending_gate"),
    }
    
    # Invoke graph
    langsmith_run = start_langsmith_run(
        name="brendan-chat",
        inputs={"message": request.message},
        tags=["chat", f"user:{request.user_id}"],
        metadata={"user_id": request.user_id},
    )
    try:
        result_state = brendan_graph.invoke(conversation_state)
    except Exception as exc:
        end_langsmith_run(langsmith_run, error=str(exc))
        raise
    end_langsmith_run(
        langsmith_run,
        outputs={
            "response": result_state.get("response"),
            "run_ids": result_state.get("run_ids", []),
        },
    )
    
    # Save checkpoint
    checkpointer.save(thread_id, result_state)

    return ChatResponse(
        response=result_state.get("response", ""),
        run_ids=result_state.get("run_ids", []),
        citations=result_state.get("citations", []),
    )


def _summarize_state(state: RunState) -> dict[str, Any]:
    return {
        "completed": bool(state.get("completed")),
        "awaiting_gate": state.get("awaiting_gate"),
        "stage": state.get("stage"),
        "persona": state.get("current_persona"),
    }


@app.post("/v1/chat/brendan", dependencies=[Depends(verify_api_key)], tags=["chat"], response_model=ChatResponse)
async def chat_with_brendan(request: ChatRequest) -> ChatResponse:
    """Run Brendan's LangChain agent off the event loop to avoid deadlocks."""
    return await run_in_threadpool(_handle_chat, request)
