"""Telegram webhook integration."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any
from uuid import UUID

from cachetools import TTLCache
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.dependencies import (
    get_artifact_repo,
    get_llama_client,
    get_run_repo,
    get_vector_db_id,
)
from agents.supervisor import create_supervisor_agent
from config import settings
from notifications.telegram import TelegramNotifier
from storage.repositories import ArtifactRepository, RunRepository
from workflows.hitl import approve_gate, reject_gate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/telegram", tags=["telegram"])

# TTL cache for idempotency - auto-expires entries after 60 seconds
IDEMPOTENCY_WINDOW_SECONDS = 60
_idempotency_cache: TTLCache = TTLCache(maxsize=10000, ttl=IDEMPOTENCY_WINDOW_SECONDS)
_idempotency_lock = asyncio.Lock()


def _redact_chat_id(chat_id: str) -> str:
    suffix = chat_id[-4:] if len(chat_id) > 4 else chat_id
    return f"telegram_*{suffix}"


def _build_message_key(
    body: dict[str, Any], chat_id: str, message_obj: dict[str, Any]
) -> str | None:
    update_id = body.get("update_id")
    if update_id is not None:
        return f"update:{update_id}"
    message_id = message_obj.get("message_id")
    if message_id is not None:
        return f"chat:{chat_id}:message:{message_id}"
    return None


async def _seen_recently(message_key: str) -> bool:
    """Check if message was seen recently using TTL cache."""
    async with _idempotency_lock:
        if message_key in _idempotency_cache:
            return True
        _idempotency_cache[message_key] = True  # TTLCache handles expiration
        return False


async def send_telegram_message(
    chat_id: str,
    text: str,
    *,
    client: httpx.AsyncClient | None = None,
    parse_mode: str = "HTML",
) -> bool:
    """Send a message to Telegram chat."""

    token = settings.telegram_bot_token
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN not configured")
        return False

    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }

    async def _post(active_client: httpx.AsyncClient) -> bool:
        try:
            resp = await active_client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json=payload,
                timeout=10,
            )
            resp.raise_for_status()
            logger.info("Sent Telegram message", extra={"chat_id": _redact_chat_id(chat_id)})
            return True
        except Exception as exc:
            logger.error("Failed to send Telegram message: %s", exc)
            return False

    if client is not None:
        return await _post(client)

    async with httpx.AsyncClient(timeout=10) as new_client:
        return await _post(new_client)


async def _answer_callback(callback_id: str | None, text: str) -> None:
    """Answer a callback query (acknowledge button click)."""

    if not callback_id or not settings.telegram_bot_token:
        return

    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            f"https://api.telegram.org/bot{settings.telegram_bot_token}/answerCallbackQuery",
            json={
                "callback_query_id": callback_id,
                "text": text,
            },
        )


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    client=Depends(get_llama_client),
) -> dict[str, Any]:
    """Receive and process Telegram webhook messages."""

    # Require webhook secret in production
    if os.getenv("ENVIRONMENT") == "production" and not settings.telegram_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook secret required in production",
        )

    secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if settings.telegram_webhook_secret and secret != settings.telegram_webhook_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid secret token")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")

    message_obj = body.get("message") or body.get("edited_message") or {}
    message_text = (message_obj.get("text") or "").strip()
    chat = message_obj.get("chat") or {}
    chat_id = str(chat.get("id") or "")
    username = chat.get("username") or chat.get("first_name") or "User"

    if not message_text or not chat_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing message or chat id"
        )

    # Validate chat ID against allowlist
    allowed_ids = settings.telegram_allowed_chat_ids
    if allowed_ids:
        if chat_id not in allowed_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chat not allowed")
    elif not settings.telegram_allow_all_chats:
        # Empty allowlist and open access not enabled
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No allowed chat IDs configured. Set TELEGRAM_ALLOW_ALL_CHATS=true to allow all.",
        )

    message_key = _build_message_key(body, chat_id, message_obj)
    if message_key and await _seen_recently(message_key):
        logger.info("Duplicate Telegram message skipped", extra={"key": message_key})
        return {"status": "ignored", "reason": "duplicate"}

    try:
        supervisor = create_supervisor_agent(client)
        session_id = f"telegram-{chat_id}"
        response = supervisor.create_turn(
            messages=[{"role": "user", "content": f"From {username}: {message_text}"}],
            session_id=session_id,
        )
        content = getattr(response, "completion_message", None)
        text = getattr(content, "content", "") if content else str(response)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Supervisor handling failed: %s", exc)
        text = "Sorry, something went wrong processing your request."

    await send_telegram_message(chat_id, text)

    return {"status": "ok"}


@router.post("/callback")
async def telegram_callback(
    request: Request,
    run_repo: RunRepository = Depends(get_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_artifact_repo),
    client=Depends(get_llama_client),
    vector_db_id: str = Depends(get_vector_db_id),
) -> dict[str, Any]:
    """Handle Telegram callback queries (inline button clicks)."""

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    callback_query = body.get("callback_query")
    if not callback_query:
        return {"ok": True}

    callback_id = callback_query.get("id")
    data = callback_query.get("data", "")
    chat_id = str(callback_query.get("message", {}).get("chat", {}).get("id", ""))

    parts = data.split(":")
    if len(parts) != 3:
        await _answer_callback(callback_id, "Invalid callback data")
        return {"ok": True, "error": "invalid_callback"}

    action, run_id_str, gate = parts
    notifier = TelegramNotifier()

    try:
        run_uuid = UUID(run_id_str)
    except Exception:
        await _answer_callback(callback_id, "Invalid run id")
        return {"ok": True, "error": "invalid_run"}

    if action == "approve":
        try:
            approve_gate(
                client=client,
                run_id=run_uuid,
                gate=gate,
                run_repo=run_repo,
                artifact_repo=artifact_repo,
                vector_db_id=vector_db_id,
                notifier=notifier,
            )
            await _answer_callback(callback_id, f"✅ {gate} approved!")
            await notifier.send_message(
                chat_id,
                f"✅ Gate <code>{gate}</code> approved for run <code>{run_id_str}</code>. Continuing workflow...",
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Callback approve failed: %s", exc)
            await _answer_callback(callback_id, "❌ Failed to approve")
            return {"ok": True, "error": "approve_failed"}

    elif action == "reject":
        try:
            reject_gate(
                run_id=run_uuid,
                gate=gate,
                run_repo=run_repo,
                artifact_repo=artifact_repo,
                notifier=notifier,
            )
            await _answer_callback(callback_id, "❌ Run cancelled")
            await notifier.send_message(
                chat_id,
                f"❌ Run <code>{run_id_str}</code> has been cancelled.",
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Callback reject failed: %s", exc)
            await _answer_callback(callback_id, "❌ Failed to reject")
            return {"ok": True, "error": "reject_failed"}
    else:
        await _answer_callback(callback_id, "Unknown action")
        return {"ok": True, "error": "unknown_action"}

    return {"ok": True}
