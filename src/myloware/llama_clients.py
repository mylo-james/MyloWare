"""Llama Stack client helpers (async- and sync-safe).

This module centralizes construction of Llama Stack clients and provides
lightweight helpers for async chat completion/streaming. It is intended to
be the single surface for obtaining clients inside the app; async code should
*always* call `get_async_client`, and sync-only code (CLI/cron) should call
`get_sync_client`.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, AsyncIterator, Optional, TypeGuard

from llama_stack_client import AsyncLlamaStackClient, LlamaStackClient

from myloware.config import settings
from myloware.observability.logging import get_logger
from myloware.resilience.circuit_breaker import CircuitBreaker, CircuitBreakerError

logger = get_logger(__name__)

__all__ = [
    "get_async_client",
    "get_sync_client",
    "clear_client_cache",
    "async_chat_complete",
    "async_chat_stream",
    "list_models",
    "list_models_async",
    "verify_connection",
    "LlamaStackConnectionError",
    "ResilientClient",
    "_get_circuit_breaker",
]


class LlamaStackConnectionError(Exception):
    """Raised when connection to Llama Stack fails."""

    def __init__(self, message: str, url: str, cause: Exception | None = None):
        self.url = url
        self.cause = cause
        super().__init__(f"{message} (url={url})")


_llama_stack_circuit_breaker: CircuitBreaker | None = None


def _get_circuit_breaker() -> CircuitBreaker | None:
    """Get or initialize the circuit breaker."""
    global _llama_stack_circuit_breaker
    if _llama_stack_circuit_breaker is None and settings.circuit_breaker_enabled:
        _llama_stack_circuit_breaker = CircuitBreaker(
            name="llama_stack",
            failure_threshold=settings.circuit_breaker_failure_threshold,
            recovery_timeout=settings.circuit_breaker_recovery_timeout,
        )
    return _llama_stack_circuit_breaker


def _is_proxyable_resource(value: Any) -> TypeGuard[object]:
    """Return True if value should be wrapped for nested call interception."""
    # Avoid proxying common primitives/containers.
    return not isinstance(
        value,
        (
            str,
            bytes,
            bytearray,
            int,
            float,
            bool,
            type(None),
            dict,
            list,
            tuple,
            set,
            frozenset,
        ),
    )


class _ResilientProxy:
    """Proxy that wraps nested resource objects so circuit breaker covers .foo.bar.baz()."""

    def __init__(self, obj: Any, circuit_breaker: CircuitBreaker, path: str):
        self._obj = obj
        self._circuit_breaker = circuit_breaker
        self._path = path

    def __getattr__(self, name: str) -> Any:  # pragma: no cover - exercised via ResilientClient
        attr = getattr(self._obj, name)
        full_path = f"{self._path}.{name}" if self._path else name

        if callable(attr):

            def wrapped(*args: Any, **kwargs: Any) -> Any:
                try:
                    return self._circuit_breaker.call(attr, *args, **kwargs)
                except CircuitBreakerError as exc:
                    logger.warning("Circuit breaker rejected call to %s: %s", full_path, exc)
                    raise LlamaStackConnectionError(
                        message=f"Circuit breaker is open for {full_path}",
                        url=settings.llama_stack_url,
                        cause=exc,
                    ) from exc

            return wrapped

        if _is_proxyable_resource(attr):
            return _ResilientProxy(attr, self._circuit_breaker, full_path)

        return attr


class ResilientClient:
    """Wrapper around LlamaStackClient with optional circuit breaker."""

    def __init__(self, client: LlamaStackClient, circuit_breaker: CircuitBreaker | None = None):
        self._client = client
        self._circuit_breaker = circuit_breaker or _get_circuit_breaker()

    def __getattr__(self, name: str) -> Any:  # pragma: no cover - passthrough
        attr = getattr(self._client, name)
        if callable(attr) and self._circuit_breaker:

            def wrapped(*args: Any, **kwargs: Any) -> Any:
                try:
                    return self._circuit_breaker.call(attr, *args, **kwargs)
                except CircuitBreakerError as exc:
                    logger.warning("Circuit breaker rejected call to %s: %s", name, exc)
                    raise LlamaStackConnectionError(
                        message=f"Circuit breaker is open for {name}",
                        url=settings.llama_stack_url,
                        cause=exc,
                    ) from exc

            return wrapped

        if self._circuit_breaker and _is_proxyable_resource(attr):
            return _ResilientProxy(attr, self._circuit_breaker, name)

        return attr

    @property
    def circuit_breaker(self) -> CircuitBreaker | None:
        return self._circuit_breaker


@lru_cache(maxsize=1)
def get_sync_client() -> LlamaStackClient | ResilientClient:
    """Cached sync client for CLI/cron and other sync paths."""
    logger.info("Creating sync Llama Stack client for %s", settings.llama_stack_url)
    try:
        client = LlamaStackClient(
            base_url=settings.llama_stack_url,
            timeout=120.0,
        )
        if settings.circuit_breaker_enabled:
            return ResilientClient(client)
        return client
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to create sync Llama Stack client: %s", exc)
        raise LlamaStackConnectionError(
            message="Failed to create Llama Stack client",
            url=settings.llama_stack_url,
            cause=exc,
        ) from exc


@lru_cache(maxsize=1)
def get_async_client() -> AsyncLlamaStackClient:
    """Cached async client for FastAPI and LangGraph."""
    logger.info("Creating async Llama Stack client for %s", settings.llama_stack_url)
    try:
        return AsyncLlamaStackClient(
            base_url=settings.llama_stack_url,
            timeout=120.0,
        )
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to create async Llama Stack client: %s", exc)
        raise LlamaStackConnectionError(
            message="Failed to create async Llama Stack client",
            url=settings.llama_stack_url,
            cause=exc,
        ) from exc


def clear_client_cache() -> None:
    """Clear both sync and async client caches (useful for tests)."""
    get_sync_client.cache_clear()
    get_async_client.cache_clear()
    logger.debug("Llama Stack client caches cleared")


async def async_chat_complete(
    messages: list[dict[str, Any]],
    model_id: Optional[str] = None,
    client: Optional[AsyncLlamaStackClient] = None,
    stream: bool = False,
) -> Any:
    """Run an async chat completion; optionally stream."""
    client = client or get_async_client()
    model = model_id or settings.llama_stack_model
    if stream:
        return async_chat_stream(messages=messages, model_id=model, client=client)
    response = await client.chat.completions.create(model=model, messages=messages, stream=False)
    return _extract_content(response)


async def async_chat_stream(
    messages: list[dict[str, Any]],
    model_id: Optional[str] = None,
    client: Optional[AsyncLlamaStackClient] = None,
) -> AsyncIterator[str]:
    """Yield content chunks from an async streaming completion."""
    client = client or get_async_client()
    model = model_id or settings.llama_stack_model
    stream = await client.chat.completions.create(model=model, messages=messages, stream=True)
    async for chunk in stream:  # type: ignore[operator]
        content = _extract_streaming_chunk(chunk)
        if content:
            yield content


def _extract_content(response: Any) -> str:
    if response is None:
        return ""
    if hasattr(response, "choices") and response.choices:
        message = response.choices[0].message
        content = getattr(message, "content", None)
        if content:
            return str(content)
    if hasattr(response, "content"):
        return str(response.content)
    return ""


def _extract_streaming_chunk(chunk: Any) -> str:
    # Handle OpenAI-style delta
    if hasattr(chunk, "choices"):
        for choice in chunk.choices:
            delta = getattr(choice, "delta", None)
            if delta and getattr(delta, "content", None):
                return str(delta.content)
            if getattr(choice, "message", None) and getattr(choice.message, "content", None):
                return str(choice.message.content)
    if hasattr(chunk, "content"):
        return str(chunk.content)
    return ""


def list_models(client: Optional[LlamaStackClient | ResilientClient] = None) -> list[str]:
    """List available model identifiers from Llama Stack."""
    client = client or get_sync_client()
    try:
        models = client.models.list()
        return [m.identifier for m in models]
    except Exception as exc:  # pragma: no cover - defensive
        raise LlamaStackConnectionError(
            message="Failed to list models",
            url=settings.llama_stack_url,
            cause=exc,
        ) from exc


async def list_models_async(client: Optional[AsyncLlamaStackClient] = None) -> list[str]:
    """Async list available model identifiers from Llama Stack."""
    client = client or get_async_client()
    try:
        models = await client.models.list()
        return [m.identifier for m in models]
    except Exception as exc:  # pragma: no cover - defensive
        raise LlamaStackConnectionError(
            message="Failed to list models (async)",
            url=settings.llama_stack_url,
            cause=exc,
        ) from exc


def verify_connection(
    client: Optional[LlamaStackClient | ResilientClient] = None,
) -> dict[str, Any]:
    """Verify Llama Stack connectivity with a lightweight inference call."""
    client = client or get_sync_client()

    result: dict[str, Any] = {
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
            return result

        model_id = settings.llama_stack_model
        if model_id not in models:
            model_id = models[0]
        result["model_tested"] = model_id

        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": "Say 'hello' and nothing else."}],
            stream=False,
        )
        content = _extract_content(response)
        if not content:
            result["error"] = "Inference returned empty response"
            return result

        result["inference_works"] = True
        result["success"] = True
        return result
    except Exception as exc:  # pragma: no cover - defensive
        result["error"] = str(exc)
        return result
