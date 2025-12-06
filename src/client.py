"""Llama Stack client factory and connection utilities."""

from __future__ import annotations

import logging
from functools import lru_cache
from types import GeneratorType
from typing import List, Dict, Any, Iterator

from langfuse import observe
from llama_stack_client import LlamaStackClient

from config import settings

logger = logging.getLogger(__name__)

__all__ = [
    "get_client",
    "clear_client_cache",
    "list_models",
    "verify_connection",
    "chat_completion",
    "extract_content",
    "extract_streaming_chunk",
    "collect_stream",
    "LlamaStackConnectionError",
]


class LlamaStackConnectionError(Exception):
    """Raised when connection to Llama Stack fails."""

    def __init__(self, message: str, url: str, cause: Exception | None = None):
        self.url = url
        self.cause = cause
        super().__init__(f"{message} (url={url})")


@lru_cache(maxsize=1)
def get_client() -> LlamaStackClient:
    """
    Get a cached Llama Stack client instance.

    Returns:
        LlamaStackClient configured with settings.llama_stack_url

    Raises:
        LlamaStackConnectionError: If client creation fails
    """
    logger.info("Creating Llama Stack client for %s", settings.llama_stack_url)
    try:
        client = LlamaStackClient(base_url=settings.llama_stack_url)
        logger.info("Llama Stack client created successfully")
        return client
    except Exception as exc:  # pragma: no cover - defensive logging path
        logger.error("Failed to create Llama Stack client: %s", exc)
        raise LlamaStackConnectionError(
            message="Failed to create Llama Stack client",
            url=settings.llama_stack_url,
            cause=exc,
        ) from exc


def clear_client_cache() -> None:
    """Clear the cached client instance. Useful for testing."""
    get_client.cache_clear()
    logger.debug("Llama Stack client cache cleared")


def list_models(client: LlamaStackClient | None = None) -> List[str]:
    """
    List available models from Llama Stack.

    Args:
        client: Optional client instance. Uses cached client if not provided.

    Returns:
        List of model identifier strings

    Raises:
        LlamaStackConnectionError: If listing models fails
    """
    if client is None:
        client = get_client()

    try:
        models = client.models.list()
        identifiers = [model.identifier for model in models]
        logger.info("Retrieved %d models from Llama Stack", len(identifiers))
        return identifiers
    except Exception as exc:
        logger.error("Failed to list models from %s: %s", settings.llama_stack_url, exc)
        raise LlamaStackConnectionError(
            message="Failed to list models",
            url=settings.llama_stack_url,
            cause=exc,
        ) from exc


def verify_connection(client: LlamaStackClient | None = None) -> Dict[str, Any]:
    """
    Verify connection to Llama Stack with a test inference.

    Args:
        client: Optional client instance. Uses cached client if not provided.

    Returns:
        Dict with verification results:
        {
            "success": bool,
            "models_available": int,
            "inference_works": bool,
            "model_tested": str | None,
            "error": str | None
        }
    """
    if client is None:
        client = get_client()

    result: Dict[str, Any] = {
        "success": False,
        "models_available": 0,
        "inference_works": False,
        "model_tested": None,
        "error": None,
    }

    try:
        models = list_models(client)
        result["models_available"] = len(models)

        if not models:
            result["error"] = "No models available"
            logger.warning("No models available on Llama Stack at %s", settings.llama_stack_url)
            return result

        model_id = settings.llama_stack_model
        if model_id not in models:
            logger.warning("Configured model %s not available; using %s", model_id, models[0])
            model_id = models[0]

        result["model_tested"] = model_id

        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": "Say 'hello' and nothing else."}],
            stream=False,
        )

        # Handle OpenAI-style response format
        content = None
        if response.choices:
            message = response.choices[0].message
            content = getattr(message, "content", None)

        if content:
            result["inference_works"] = True
            result["success"] = True
            logger.info("Connection verified against model %s", model_id)
        else:
            result["error"] = "Inference returned empty response"
            logger.warning("Inference returned empty response for model %s", model_id)

    except LlamaStackConnectionError as exc:
        result["error"] = str(exc)
        logger.error("Connection verification failed: %s", exc)
    except Exception as exc:  # pragma: no cover - defensive path
        result["error"] = str(exc)
        logger.error("Unexpected error verifying connection: %s", exc)

    return result


@observe(as_type="generation", name="chat_completion")
def chat_completion(
    messages: List[dict],
    model_id: str | None = None,
    system_message: str | None = None,
    stream: bool = False,
    client: LlamaStackClient | None = None,
) -> Any:
    """
    Run a chat completion against Llama Stack.

    Args:
        messages: List of message dicts with 'role' and 'content'
        model_id: Model to use. Defaults to settings.llama_stack_model
        system_message: Optional system message to prepend
        stream: If True, return streaming iterator
        client: Optional client instance

    Returns:
        If stream=False: Response content string
        If stream=True: Iterator yielding content chunks
    """
    if client is None:
        client = get_client()

    if model_id is None:
        model_id = settings.llama_stack_model

    full_messages: List[dict] = []
    if system_message:
        full_messages.append({"role": "system", "content": system_message})
    full_messages.extend(messages)

    logger.info("Running chat completion with model=%s, stream=%s", model_id, stream)

    try:
        if stream:
            return _stream_chat_completion(client, model_id, full_messages)
        return _sync_chat_completion(client, model_id, full_messages)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Chat completion failed: %s", exc)
        raise LlamaStackConnectionError(
            message="Chat completion failed",
            url=settings.llama_stack_url,
            cause=exc,
        ) from exc


def _sync_chat_completion(
    client: LlamaStackClient,
    model_id: str,
    messages: List[dict],
) -> str:
    """Run synchronous chat completion and extract content."""
    response = client.chat.completions.create(
        model=model_id,
        messages=messages,
        stream=False,
    )

    content = extract_content(response)

    usage = getattr(response, "usage", None)
    if usage:
        prompt_tokens = usage.get("prompt_tokens") if isinstance(usage, dict) else getattr(usage, "prompt_tokens", None)
        completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else getattr(usage, "completion_tokens", None)
        logger.info(
            "Completion finished: prompt_tokens=%s, completion_tokens=%s",
            prompt_tokens,
            completion_tokens,
        )

    return content


def _stream_chat_completion(
    client: LlamaStackClient,
    model_id: str,
    messages: List[dict],
) -> Iterator[str]:
    """Run streaming chat completion and yield content chunks."""
    response = client.chat.completions.create(
        model=model_id,
        messages=messages,
        stream=True,
    )

    for chunk in response:
        content = extract_streaming_chunk(chunk)
        if content:
            yield content


def extract_content(response: Any) -> str:
    """
    Extract text content from a chat completion response.

    Handles both sync responses, streaming generators, and OpenAI-style responses.

    Returns:
        Extracted text content
    """
    if response is None:
        return ""

    # Handle streaming generators from create_turn
    if isinstance(response, GeneratorType):
        return _collect_agent_stream(response)

    # Handle OpenAI-style response format (new Llama Stack API)
    if hasattr(response, "choices") and response.choices:
        message = response.choices[0].message
        content = getattr(message, "content", None)
        if content:
            return str(content)

    # Legacy: Handle old completion_message format
    if hasattr(response, "completion_message"):
        msg = response.completion_message
        if hasattr(msg, "content"):
            content = msg.content
            if isinstance(content, str):
                return content
            if hasattr(content, "text"):
                return content.text

    if hasattr(response, "content"):
        return str(response.content)

    if isinstance(response, dict):
        # OpenAI-style dict
        if "choices" in response and response["choices"]:
            msg = response["choices"][0].get("message", {})
            return msg.get("content", "")
        if "completion_message" in response:
            return response["completion_message"].get("content", "")
        if "content" in response:
            return response["content"]

    logger.warning("Could not extract content from response type %s", type(response))
    return str(response)


def extract_streaming_chunk(chunk: Any) -> str | None:
    """
    Extract text content from a streaming chunk.

    Handles both legacy format and new OpenAI-style format.
    """
    if chunk is None:
        return None

    # OpenAI-style streaming chunk (new Llama Stack API)
    if hasattr(chunk, "choices") and chunk.choices:
        delta = chunk.choices[0].delta
        if hasattr(delta, "content") and delta.content:
            return delta.content

    # Legacy event-based format
    if hasattr(chunk, "event") and hasattr(chunk.event, "delta"):
        delta = chunk.event.delta
        if isinstance(delta, str):
            return delta
        if hasattr(delta, "text"):
            return delta.text

    if hasattr(chunk, "delta"):
        return str(chunk.delta)

    if isinstance(chunk, dict):
        # OpenAI-style dict
        if "choices" in chunk and chunk["choices"]:
            delta = chunk["choices"][0].get("delta", {})
            return delta.get("content")
        if "event" in chunk and "delta" in chunk["event"]:
            return chunk["event"]["delta"]
        if "delta" in chunk:
            return chunk["delta"]

    return None


def collect_stream(stream: Iterator[str]) -> str:
    """
    Collect all chunks from a streaming response into a single string.
    """
    chunks: List[str] = []
    for chunk in stream:
        chunks.append(chunk)
    return "".join(chunks)


def _collect_agent_stream(stream: GeneratorType) -> str:
    """
    Collect content from an agent turn streaming response.

    New Llama Stack API event structure (AgentStreamChunk):
    - event.event.event_type: turn_started, step_started, step_progress, step_completed, turn_completed
    - step_progress: event.event.delta.text contains incremental text
    - turn_completed: event.response.output[0].content[0].text contains final response
    
    Legacy structure (if present):
    - event.event.payload.event_type with nested structure
    """
    chunks: List[str] = []
    tool_results: List[str] = []
    final_content = ""

    for event in stream:
        if not hasattr(event, "event"):
            continue

        ev = event.event
        event_type = getattr(ev, "event_type", None)

        # New API: step_progress events have delta directly on event
        if event_type == "step_progress":
            delta = getattr(ev, "delta", None)
            if delta:
                # New format: TextDelta object with text attribute
                text = getattr(delta, "text", None)
                if text:
                    chunks.append(text)

        # New API: turn_completed has response on the AgentStreamChunk
        elif event_type == "turn_completed":
            # Check for response on the chunk itself (new API)
            response = getattr(event, "response", None)
            if response and hasattr(response, "output"):
                for output_item in response.output:
                    if hasattr(output_item, "content"):
                        for content_item in output_item.content:
                            if hasattr(content_item, "text"):
                                final_content = content_item.text
                                break
                    elif hasattr(output_item, "text"):
                        final_content = output_item.text
                        break

        # Legacy API support: check for payload structure
        elif hasattr(ev, "payload"):
            payload = ev.payload
            legacy_event_type = getattr(payload, "event_type", None)

            if legacy_event_type == "step_progress":
                delta = getattr(payload, "delta", None)
                if delta:
                    text = getattr(delta, "text", None)
                    if text:
                        chunks.append(text)

            elif legacy_event_type == "step_complete":
                step_type = getattr(payload, "step_type", None)
                if step_type == "tool_execution":
                    step_details = getattr(payload, "step_details", None)
                    if step_details:
                        responses = getattr(step_details, "tool_responses", [])
                        for tr in responses:
                            if hasattr(tr, "content") and tr.content:
                                tool_results.append(tr.content)

            elif legacy_event_type == "turn_complete":
                turn = getattr(payload, "turn", None)
                if turn:
                    output = getattr(turn, "output_message", None)
                    if output:
                        content = getattr(output, "content", None)
                        if isinstance(content, str):
                            final_content = content
                        elif isinstance(content, list):
                            texts = []
                            for block in content:
                                if isinstance(block, str):
                                    texts.append(block)
                                elif hasattr(block, "text"):
                                    texts.append(block.text)
                            final_content = "".join(texts)

    # Build result
    result_parts = []
    
    if tool_results:
        result_parts.append("## Tool Results\n")
        for i, tr in enumerate(tool_results, 1):
            result_parts.append(f"### Tool {i}\n```json\n{tr}\n```\n")
    
    if final_content:
        if tool_results:
            result_parts.append("\n## Summary\n")
        result_parts.append(final_content)
    elif chunks:
        result_parts.append("".join(chunks))
    
    return "".join(result_parts) if result_parts else ""
