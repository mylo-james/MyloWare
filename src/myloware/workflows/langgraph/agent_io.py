"""Agent I/O helpers for LangGraph nodes.

This module holds small utilities that are shared across workflow nodes:
- Agent session lifecycle helpers
- Response text extraction
- Tool-response collection from streaming agent turns
- Safety-oriented content sanitization
"""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from typing import Any, Generator
from uuid import UUID

from myloware.observability.logging import get_logger
from myloware.storage.models import ArtifactType
from myloware.storage.repositories import ArtifactRepository

logger = get_logger(__name__)

__all__ = [
    "agent_session",
    "extract_content",
    "_strip_noise_for_safety",
    "_maybe_store_safety_cache",
    "SimpleMessage",
    "_tool_response_contents",
    "create_turn_collecting_tool_responses",
    "_tool_response_contents_from_payloads",
]


@contextmanager
def agent_session(client: Any, agent: Any, session_name: str) -> Generator[str, None, None]:
    """Context manager for agent sessions with automatic cleanup."""
    session_id = agent.create_session(session_name)
    try:
        yield session_id
    finally:
        try:
            client.conversations.delete(conversation_id=session_id)
            logger.debug("Cleaned up session: %s", session_id)
        except Exception as exc:
            logger.warning("Failed to cleanup session %s: %s", session_id, exc)


def extract_content(response: Any) -> str:
    """Extract primary text from Llama Stack responses (agent or chat completions)."""
    if response is None:
        return ""
    output_text = getattr(response, "output_text", None)
    if output_text:
        return str(output_text)
    choices = getattr(response, "choices", None)
    if choices:
        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", None) if message else None
        if content:
            return str(content)
    content = getattr(response, "content", None)
    return str(content) if content else ""


def _strip_noise_for_safety(text: str) -> str:
    """Remove non-semantic orchestration noise before running safety shields.

    Shields should run only on meaningful human/creative content. Tool receipts,
    IDs, URLs, and UUIDs are treated as noise and can cause false positives.
    """
    if not text:
        return ""

    sanitized = text
    # Remove orchestration-only tool invocation directives; shields should focus
    # on human/creative content, not agent control flow.
    sanitized = re.sub(r"(?is)(?:^|\n)CRITICAL:.*", "", sanitized)
    sanitized = re.sub(
        r"(?im)^\s*DO NOT just output code.*?tool!?\s*$",
        "",
        sanitized,
    )
    # Sora task IDs like video_693bcfa...
    sanitized = re.sub(r"\bvideo_[A-Za-z0-9_-]{8,}\b", "<video_task_id>", sanitized)
    # Remotion job IDs / other opaque ids
    sanitized = re.sub(r"\bfake-render-[A-Za-z0-9_-]+\b", "<render_job_id>", sanitized)
    sanitized = re.sub(r"\bjob_[A-Za-z0-9_-]{6,}\b", "<render_job_id>", sanitized)
    # UUIDs
    sanitized = re.sub(
        r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
        "<uuid>",
        sanitized,
    )
    # URLs
    sanitized = re.sub(r"\"https?://[^\"]+\"", '"<url>"', sanitized)
    sanitized = re.sub(r"https?://\S+", "<url>", sanitized)
    return sanitized.strip()


async def _maybe_store_safety_cache(
    state: dict[str, Any], artifact_repo: ArtifactRepository, run_id: UUID
) -> None:
    """Persist safety cache as a run artifact for UI visibility."""
    cache = state.get("safety_cache") or {}
    if not cache:
        return
    try:
        await artifact_repo.create_async(
            run_id=run_id,
            persona="safety",
            artifact_type=ArtifactType.SAFETY_VERDICT,
            content=json.dumps(cache),
            metadata={"type": "safety_cache", "entries": len(cache)},
        )
    except Exception as exc:  # don't fail workflow on telemetry artifact
        logger.warning("Failed to store safety cache artifact: %s", exc)


class SimpleMessage:
    """Minimal message wrapper exposing .content for tool parsing."""

    def __init__(self, content: str):
        self.content = content


def _tool_response_contents(response: Any, tool_name: str) -> list[Any]:
    """Collect tool response contents for a given tool name across common Llama Stack shapes.

    We keep this tolerant to SDK drift while still failing fast if no evidence exists.
    """

    contents: list[Any] = []

    def _maybe_add(tool_response: Any) -> None:
        if tool_response is None:
            return
        name = getattr(tool_response, "tool_name", None) or getattr(tool_response, "name", None)
        if name is None and isinstance(tool_response, dict):
            name = tool_response.get("tool_name") or tool_response.get("name")
        if name != tool_name:
            return
        content = (
            getattr(tool_response, "content", None)
            if hasattr(tool_response, "content")
            else tool_response.get("content") if isinstance(tool_response, dict) else None
        )
        if content is not None:
            contents.append(content)

    steps = getattr(response, "steps", None) or []
    for step in steps:
        if getattr(step, "step_type", None) != "tool_execution":
            continue
        result_obj = getattr(step, "result", None)
        tool_responses = []
        if result_obj and hasattr(result_obj, "tool_responses"):
            tool_responses = getattr(result_obj, "tool_responses") or []
        elif hasattr(step, "tool_responses"):
            tool_responses = getattr(step, "tool_responses") or []
        for tr in tool_responses:
            _maybe_add(tr)

    # Some SDK shapes attach tool_responses at the top-level result.
    for container in (getattr(response, "result", None), response):
        if not container:
            continue
        trs = getattr(container, "tool_responses", None)
        if trs:
            for tr in trs:
                _maybe_add(tr)

    return contents


def _normalize_tool_response_payload(tool_response: Any) -> dict[str, Any] | None:
    """Best-effort normalize a tool response into a consistent payload."""
    if tool_response is None:
        return None

    if isinstance(tool_response, dict):
        tool_name = tool_response.get("tool_name") or tool_response.get("name")
        if not tool_name:
            return None
        return {
            "call_id": tool_response.get("call_id"),
            "tool_name": tool_name,
            "content": tool_response.get("content"),
            "metadata": tool_response.get("metadata"),
        }

    tool_name = getattr(tool_response, "tool_name", None) or getattr(tool_response, "name", None)
    if not tool_name:
        return None
    return {
        "call_id": getattr(tool_response, "call_id", None),
        "tool_name": tool_name,
        "content": getattr(tool_response, "content", None),
        "metadata": getattr(tool_response, "metadata", None),
    }


def _tool_response_payloads_from_response(response: Any) -> list[dict[str, Any]]:
    """Extract tool response payloads from a non-streaming response object."""
    payloads: list[dict[str, Any]] = []

    steps = getattr(response, "steps", None) or []
    for step in steps:
        if getattr(step, "step_type", None) != "tool_execution":
            continue
        result_obj = getattr(step, "result", None)
        tool_responses = []
        if result_obj and hasattr(result_obj, "tool_responses"):
            tool_responses = getattr(result_obj, "tool_responses") or []
        elif hasattr(step, "tool_responses"):
            tool_responses = getattr(step, "tool_responses") or []
        for tr in tool_responses:
            payload = _normalize_tool_response_payload(tr)
            if payload:
                payloads.append(payload)

    # Some SDK shapes attach tool_responses at the top-level result.
    for container in (getattr(response, "result", None), response):
        if not container:
            continue
        trs = getattr(container, "tool_responses", None)
        if trs:
            for tr in trs:
                payload = _normalize_tool_response_payload(tr)
                if payload:
                    payloads.append(payload)

    return payloads


def create_turn_collecting_tool_responses(
    agent: Any, messages: list[dict[str, Any]], session_id: str
) -> tuple[Any, list[dict[str, Any]]]:
    """Run a sync Agent turn in streaming mode and collect tool responses.

    llama_stack_client Agent.create_turn(stream=False) iterates the stream internally
    but only returns the final response object, discarding StepCompleted(tool_execution)
    events that contain client-side tool responses. For fail-fast orchestration, we
    need those tool outputs (task_ids, job_id, published_url) explicitly.
    """

    stream = agent.create_turn(messages, session_id, stream=True)
    tool_responses: list[dict[str, Any]] = []
    # Some SDK/fake implementations ignore `stream=True` and return the final response directly.
    try:
        stream_iter = iter(stream)
    except TypeError:
        response = stream
        tool_responses = _tool_response_payloads_from_response(response)
        return response, tool_responses

    final_response = None

    for chunk in stream_iter:
        event = getattr(chunk, "event", None)
        if getattr(event, "step_type", None) == "tool_execution":
            result = getattr(event, "result", None)
            responses = getattr(result, "tool_responses", None) or []
            for tr in responses:
                if isinstance(tr, dict):
                    tool_responses.append(tr)
                else:
                    tool_responses.append(
                        {
                            "call_id": getattr(tr, "call_id", None),
                            "tool_name": getattr(tr, "tool_name", None),
                            "content": getattr(tr, "content", None),
                            "metadata": getattr(tr, "metadata", None),
                        }
                    )

        response = getattr(chunk, "response", None)
        if response is not None:
            final_response = response

    if final_response is None:
        raise RuntimeError("Agent turn did not complete")

    if not tool_responses:
        tool_responses = _tool_response_payloads_from_response(final_response)
    else:
        fallback = _tool_response_payloads_from_response(final_response)
        if fallback:
            seen = {(resp.get("call_id"), resp.get("tool_name")) for resp in tool_responses}
            for resp in fallback:
                key = (resp.get("call_id"), resp.get("tool_name"))
                if key in seen:
                    continue
                tool_responses.append(resp)
                seen.add(key)

    return final_response, tool_responses


# Backwards-compatible alias (tests and older code paths import the underscored name).
_create_turn_collecting_tool_responses = create_turn_collecting_tool_responses


def _tool_response_contents_from_payloads(
    tool_responses: list[dict[str, Any]], tool_name: str
) -> list[Any]:
    contents: list[Any] = []

    def _matches(raw_name: Any) -> bool:
        if not raw_name:
            return False
        if raw_name == tool_name:
            return True
        if isinstance(raw_name, str):
            normalized = raw_name.split("::")[-1]
            normalized = normalized.split("/")[-1]
            normalized = normalized.split(".")[-1]
            return normalized == tool_name
        return False

    for payload in tool_responses:
        name = payload.get("tool_name") or payload.get("name")
        if not _matches(name):
            continue
        if "content" in payload and payload.get("content") is not None:
            contents.append(payload.get("content"))
            continue
        if "output" in payload and payload.get("output") is not None:
            contents.append(payload.get("output"))
            continue
        if "result" in payload and payload.get("result") is not None:
            contents.append(payload.get("result"))
    return contents
