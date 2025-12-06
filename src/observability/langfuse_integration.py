"""Langfuse observability integration for MyloWare.

Provides tracing for agent workflows, tool calls, and LLM interactions.

Usage:
    from observability.langfuse_integration import trace_workflow, trace_agent_turn

    @trace_workflow("ideation")
    def run_ideation(brief: str):
        ...

    @trace_agent_turn("ideator")
    def ideator_turn(messages):
        ...
"""

from __future__ import annotations

import logging
import os
from functools import wraps
from typing import Any, Callable

from langfuse import Langfuse, observe

from config.settings import settings

logger = logging.getLogger(__name__)

__all__ = [
    "get_langfuse",
    "trace_workflow",
    "trace_agent_turn",
    "trace_tool_call",
    "observe",
    "setup_langfuse",
]

# Global Langfuse client
_langfuse_client: Langfuse | None = None


def get_langfuse() -> Langfuse | None:
    """Get or create the Langfuse client.

    Returns None if Langfuse is not configured (no keys set).
    """
    global _langfuse_client

    if _langfuse_client is not None:
        return _langfuse_client

    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")

    if not public_key or not secret_key:
        logger.info("Langfuse not configured (no API keys). Tracing disabled.")
        return None

    # Support both LANGFUSE_HOST and LANGFUSE_BASE_URL
    host = os.getenv("LANGFUSE_HOST") or os.getenv(
        "LANGFUSE_BASE_URL", "https://cloud.langfuse.com"
    )

    try:
        _langfuse_client = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=host,
        )
        logger.info("Langfuse client initialized: %s", host)
        return _langfuse_client
    except Exception as exc:
        logger.warning("Failed to initialize Langfuse: %s", exc)
        return None


def setup_langfuse() -> None:
    """Initialize Langfuse at application startup."""
    client = get_langfuse()
    if client:
        logger.info("Langfuse tracing enabled")
    else:
        logger.info("Langfuse tracing disabled (no credentials)")


def trace_workflow(workflow_name: str) -> Callable:
    """Decorator to trace an entire workflow execution.

    Creates a trace with metadata about the workflow run.

    Example:
        @trace_workflow("video_production")
        def run_video_workflow(run_id: str, brief: str):
            ...
    """

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            langfuse = get_langfuse()
            if langfuse is None:
                return func(*args, **kwargs)

            # Extract run_id if present
            run_id = kwargs.get("run_id") or (args[0] if args else None)

            trace = langfuse.trace(
                name=f"workflow:{workflow_name}",
                metadata={
                    "workflow": workflow_name,
                    "run_id": str(run_id) if run_id else None,
                },
                tags=["workflow", workflow_name],
            )

            try:
                result = func(*args, **kwargs)
                trace.update(output={"status": "completed"})
                return result
            except Exception as exc:
                trace.update(
                    output={"status": "failed", "error": str(exc)},
                    level="ERROR",
                    status_message=str(exc),
                )
                raise
            finally:
                langfuse.flush()

        return wrapper

    return decorator


def trace_agent_turn(agent_name: str, model: str | None = None) -> Callable:
    """Decorator to trace an agent turn (LLM call).

    Creates a generation span with agent metadata.

    Args:
        agent_name: Name of the agent (e.g., "ideator", "producer")
        model: Model identifier for tracing. Defaults to settings.llama_stack_model.

    Example:
        @trace_agent_turn("ideator", model="openai/gpt-4o-mini")
        def run_ideator_turn(messages, session_id):
            return agent.create_turn(messages=messages, session_id=session_id)
    """
    # Use provided model or fall back to configured default
    actual_model = model or settings.llama_stack_model

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            langfuse = get_langfuse()
            if langfuse is None:
                return func(*args, **kwargs)

            # Extract messages if present
            messages = kwargs.get("messages") or (args[0] if args else [])

            generation = langfuse.generation(
                name=f"agent:{agent_name}",
                model=actual_model,
                input=messages,
                metadata={"agent": agent_name, "model": actual_model},
            )

            try:
                result = func(*args, **kwargs)
                # Try to extract output from result
                output = result if isinstance(result, str) else str(result)[:500]
                generation.update(output=output)
                return result
            except Exception as exc:
                generation.update(
                    output={"error": str(exc)},
                    level="ERROR",
                    status_message=str(exc),
                )
                raise
            finally:
                generation.end()
                langfuse.flush()

        return wrapper

    return decorator


def trace_tool_call(tool_name: str) -> Callable:
    """Decorator to trace a tool call.

    Creates a span for tool execution.

    Example:
        @trace_tool_call("knowledge_search")
        def search_knowledge(query: str):
            ...
    """

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            langfuse = get_langfuse()
            if langfuse is None:
                return func(*args, **kwargs)

            span = langfuse.span(
                name=f"tool:{tool_name}",
                input={"args": args, "kwargs": kwargs},
                metadata={"tool": tool_name},
            )

            try:
                result = func(*args, **kwargs)
                span.update(output=result)
                return result
            except Exception as exc:
                span.update(
                    output={"error": str(exc)},
                    level="ERROR",
                    status_message=str(exc),
                )
                raise
            finally:
                span.end()
                langfuse.flush()

        return wrapper

    return decorator


def flush_traces() -> None:
    """Flush any buffered traces to Langfuse."""
    langfuse = get_langfuse()
    if langfuse:
        langfuse.flush()
