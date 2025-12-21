from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable

from opentelemetry import trace
from fastapi import Request
from fastapi.responses import JSONResponse, Response

from myloware.config import settings
from myloware.config.provider_modes import effective_llama_stack_provider
from myloware.llama_clients import get_async_client
from myloware.observability.logging import get_logger
from myloware.safety import shields as shield_utils

logger = get_logger("api.middleware.safety")
tracer = trace.get_tracer("myloware.api.safety")

# Fast keyword screen (first pass). Llama Guard available via Llama Stack Safety API for agents.
_TOXIC_KEYWORDS = (
    "kill",
    "bomb",
    "terrorist",
    "hate speech",
    "murder",
    "shoot",
    "suicide",
    "racial slur",
)


@dataclass
class SafetyVerdict:
    """Safety evaluation result."""

    safe: bool
    reason: str | None = None


async def check_content_safety(content: str) -> SafetyVerdict:
    """Run shield-backed safety check with keyword fallback."""
    llama_mode = effective_llama_stack_provider(settings)
    if settings.enable_safety_shields:
        try:
            client = get_async_client()
            result = await shield_utils.check_content_safety(
                client,
                content,
                shield_id=settings.content_safety_shield_id,
            )
            # Only block if content is actually unsafe, not if check failed due to system error
            if not result.safe and getattr(result, "category", None) != "system_error":
                return SafetyVerdict(
                    safe=False,
                    reason=result.reason or f"shield:{settings.content_safety_shield_id}",
                )
            elif not result.safe and getattr(result, "category", None) == "system_error":
                # Fail closed unless explicitly in fake-provider mode
                if llama_mode != "real":
                    logger.warning(
                        "Shield system error with non-real Llama Stack, falling back to keyword scan: %s",
                        result.reason,
                    )
                    # fall through to keyword scan
                else:
                    return SafetyVerdict(safe=False, reason=result.reason or "shield_system_error")
        except Exception as exc:
            logger.error(
                "shield_check_failed in middleware",
                exc=str(exc),
                exc_type=type(exc).__name__,
                exc_repr=repr(exc),
                settings_shield=settings.content_safety_shield_id,
            )
            if llama_mode == "real":
                return SafetyVerdict(safe=False, reason="shield_error")
            # In fake mode, fall through to keyword scan

    lowered = content.lower()
    for keyword in _TOXIC_KEYWORDS:
        if keyword in lowered:
            return SafetyVerdict(safe=False, reason=f"matched_keyword:{keyword}")
    return SafetyVerdict(safe=True)


async def keyword_only(content: str) -> SafetyVerdict:
    """Keyword-only safety check."""
    lowered = content.lower()
    for keyword in _TOXIC_KEYWORDS:
        if keyword in lowered:
            return SafetyVerdict(safe=False, reason=f"matched_keyword:{keyword}")
    return SafetyVerdict(safe=True)


async def safety_shield_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Middleware that blocks toxic content on write endpoints.

    Safety always fails closed - if shield is unavailable, content is blocked.
    Use LLAMA_STACK_PROVIDER=fake/off for testing scenarios where shield is unavailable.
    """

    if request.method not in {"POST", "PUT", "PATCH"}:
        return await call_next(request)

    # Webhook endpoints are machine-to-machine callbacks. They are authenticated
    # (signature/HMAC) and schema-validated in their handlers, and running LLM
    # safety shields on their raw JSON payloads creates false positives that can
    # stall workflows (e.g., blocking Sora/Remotion callbacks).
    if str(request.url.path).startswith("/v1/webhooks/"):
        return await call_next(request)

    if not settings.enable_safety_shields:
        return await call_next(request)

    # Skip shield when Llama Stack is non-real (for testing). Still run keyword filter.
    skip_shield = effective_llama_stack_provider(settings) != "real"

    raw_body = await request.body()
    # Preserve body for downstream handlers
    # Note: _body is a private FastAPI attribute not in type hints, but needed for middleware
    # Mypy doesn't flag this as an error, but it's a runtime attribute assignment
    request._body = raw_body
    content = raw_body.decode("utf-8", errors="ignore")

    # Run-start endpoints carry structured JSON. Running Llama Guard on the raw JSON
    # string can produce false positives (the model may refuse the JSON) and block
    # safe briefs. Extract only the user-authored text fields for shield evaluation.
    path = str(request.url.path)
    if path in {"/v1/runs/start", "/v2/runs/start"}:
        import json as _json

        extracted_run_start: list[str] = []
        try:
            payload = _json.loads(content) if content.strip().startswith("{") else None
        except Exception:
            payload = None

        if isinstance(payload, dict):
            brief_val = payload.get("brief")
            if isinstance(brief_val, str) and brief_val.strip():
                extracted_run_start.append(brief_val.strip())

        if extracted_run_start:
            content = "\n\n".join(extracted_run_start)

    # HITL control-plane endpoints carry small structured payloads (ids + booleans).
    # Running Llama Guard on the *raw JSON* can false-positive and stall workflows.
    # For these endpoints, extract only the human text fields (e.g. comment/override)
    # and run safety on that.
    if path.startswith("/v2/runs/") and (
        path.endswith("/approve") or path.endswith("/approve/hitl") or path.endswith("/reject")
    ):
        import json as _json

        extracted_hitl: list[str] = []
        try:
            payload = _json.loads(content) if content.strip().startswith("{") else None
        except Exception:
            payload = None

        if isinstance(payload, dict):
            for key in ("comment", "content_override"):
                val = payload.get(key)
                if isinstance(val, str) and val.strip():
                    extracted_hitl.append(val.strip())
            data_val = payload.get("data")
            if data_val is not None:
                try:
                    data_text = _json.dumps(data_val, ensure_ascii=False, separators=(",", ":"))
                except Exception:
                    data_text = str(data_val)
                if data_text.strip():
                    extracted_hitl.append(data_text)

        if extracted_hitl:
            content = "\n\n".join(extracted_hitl)
        else:
            # No free-form text in the payload; allow without a shield call.
            return await call_next(request)

    try:
        if skip_shield:
            # keyword-only path to avoid missing shield registration in dev/fake mode
            verdict = await keyword_only(content)
        else:
            with tracer.start_as_current_span(
                "safety_shield",
                attributes={
                    "http.target": str(request.url.path),
                    "http.method": request.method,
                },
            ):
                try:
                    verdict = await asyncio.wait_for(
                        check_content_safety(content),
                        timeout=5.0,
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "safety_shield_timeout",
                        path=str(request.url.path),
                        method=request.method,
                        content_length=len(raw_body),
                    )
                    verdict = SafetyVerdict(safe=False, reason="timeout_blocked")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "safety_shield_error",
            path=str(request.url.path),
            method=request.method,
            error=str(exc),
        )
        # Always fail closed - safety is critical
        verdict = SafetyVerdict(safe=False, reason="shield_error")

    if verdict.safe:
        logger.info(
            "safety_shield_pass",
            path=str(request.url.path),
            method=request.method,
            content_length=len(raw_body),
        )
        return await call_next(request)

    logger.warning(
        "content_blocked",
        reason=verdict.reason,
        path=str(request.url.path),
        method=request.method,
        content_length=len(raw_body),
        request_id=request.headers.get("X-Request-ID"),
    )
    return JSONResponse(
        status_code=400,
        content={
            "error": "content_blocked",
            "reason": verdict.reason or "unsafe_content",
        },
    )
