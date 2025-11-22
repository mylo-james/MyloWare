"""Telegram webhook integration - forwards messages to Brendan."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, status

from adapters.observability.request_id import get_request_id
from adapters.observability.sentry import capture_exception, set_context

from ..config import get_settings

logger = logging.getLogger("myloware.api.telegram")

router = APIRouter(prefix="/v1/telegram", tags=["telegram"])

IDEMPOTENCY_WINDOW_SECONDS = 60
_idempotency_cache: dict[str, float] = {}
_idempotency_lock = asyncio.Lock()


def reset_idempotency_cache() -> None:
    """Utility for tests to clear duplicate tracking state."""

    _idempotency_cache.clear()


def _redact_chat_id(chat_id: str) -> str:
    suffix = chat_id[-4:] if len(chat_id) > 4 else chat_id
    return f"telegram_*{suffix}"


def _build_message_key(body: dict[str, Any], chat_id: str, message_obj: dict[str, Any]) -> str | None:
    update_id = body.get("update_id")
    if update_id is not None:
        return f"update:{update_id}"
    message_id = message_obj.get("message_id")
    if message_id is not None:
        return f"chat:{chat_id}:message:{message_id}"
    return None


async def _seen_recently(message_key: str) -> bool:
    now = time.monotonic()
    async with _idempotency_lock:
        expired = [key for key, expires in _idempotency_cache.items() if expires <= now]
        for key in expired:
            _idempotency_cache.pop(key, None)
        if message_key in _idempotency_cache:
            return True
        _idempotency_cache[message_key] = now + IDEMPOTENCY_WINDOW_SECONDS
        return False


async def send_telegram_message(
    chat_id: str,
    text: str,
    *,
    client: httpx.AsyncClient | None = None,
    disable_preview: bool = True,
) -> None:
    settings = get_settings()
    token = settings.telegram_bot_token
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN not configured; skipping Telegram send")
        return

    async def _post(active_client: httpx.AsyncClient) -> None:
        response = await active_client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": disable_preview,
            },
            timeout=10,
        )
        response.raise_for_status()
        logger.info(
            "Sent Telegram message",
            extra={"chat_id": _redact_chat_id(chat_id), "length": len(text)},
        )

    if client is not None:
        await _post(client)
        return
    async with httpx.AsyncClient(timeout=10) as new_client:
        await _post(new_client)


async def telegram_webhook(request: Request) -> dict[str, Any]:
    """Telegram webhook: forwards all messages to Brendan's chat endpoint."""

    try:
        body = await request.json()
    except Exception as exc:  # pragma: no cover - FastAPI handles JSON parsing
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid json") from exc

    message_obj = body.get("message") or body.get("edited_message") or {}
    message_text = (message_obj.get("text") or "").strip()
    chat_id = str((message_obj.get("chat") or {}).get("id") or "")

    if not message_text or not chat_id:
        return {"ok": True}

    message_key = _build_message_key(body, chat_id, message_obj)
    if message_key and await _seen_recently(message_key):
        logger.info(
            "Duplicate Telegram update skipped",
            extra={"chat_id": _redact_chat_id(chat_id), "message_key": message_key},
        )
        return {"ok": True, "duplicate": True}

    request_id = get_request_id()
    set_context(
        "telegram_webhook",
        {
            "chat_id": _redact_chat_id(chat_id),
            "message_key": message_key,
            "request_id": request_id,
        },
    )

    settings = get_settings()
    orchestrator_url = settings.orchestrator_base_url.rstrip("/")
    api_key = settings.api_key
    logger.info(
        "Processing Telegram message",
        extra={
            "chat_id": _redact_chat_id(chat_id),
            "message_length": len(message_text),
            "orchestrator_url": orchestrator_url,
            "request_id": request_id,
        },
    )

    user_id = f"telegram_{chat_id}"
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            brendan_response = await client.post(
                f"{orchestrator_url}/v1/chat/brendan",
                json={"user_id": user_id, "message": message_text},
                headers={"x-api-key": api_key},
            )
            brendan_response.raise_for_status()
            brendan_data = brendan_response.json()
            brendan_message = brendan_data.get("response", "I'm processing your request...")
            logger.info(
                "Brendan responded",
                extra={"chat_id": _redact_chat_id(chat_id), "response_length": len(brendan_message)},
            )
            await send_telegram_message(chat_id, brendan_message, client=client)
            return {"ok": True, "brendan_response": brendan_message}
    except httpx.HTTPStatusError as exc:
        capture_exception(exc)
        logger.error(
            "HTTP error calling orchestrator",
            extra={
                "chat_id": _redact_chat_id(chat_id),
                "status_code": exc.response.status_code,
                "request_id": request_id,
            },
            exc_info=True,
        )
        await send_telegram_message(
            chat_id,
            f"Sorry, I'm having trouble processing your request (HTTP {exc.response.status_code}). Please try again.",
        )
        return {"ok": True, "error": f"HTTP {exc.response.status_code}"}
    except httpx.RequestError as exc:
        capture_exception(exc)
        logger.error(
            "Request error calling orchestrator",
            extra={"chat_id": _redact_chat_id(chat_id), "orchestrator_url": orchestrator_url, "request_id": request_id},
            exc_info=True,
        )
        await send_telegram_message(
            chat_id,
            "Sorry, I couldn't reach the orchestrator. Please make sure the service is running and try again.",
        )
        return {"ok": True, "error": str(exc)}
    except Exception as exc:  # pragma: no cover - defensive catch-all
        capture_exception(exc)
        logger.error(
            "Unexpected error in Telegram webhook",
            extra={"chat_id": _redact_chat_id(chat_id), "request_id": request_id},
            exc_info=True,
        )
        await send_telegram_message(
            chat_id,
            "Sorry, an unexpected error occurred. Please try again later.",
        )
        return {"ok": True, "error": str(exc)}

    return {"ok": True}

