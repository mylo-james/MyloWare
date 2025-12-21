"""Telegram webhook integration."""

from __future__ import annotations

import asyncio
import os
from typing import Any
from uuid import UUID

from cachetools import TTLCache  # type: ignore
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from llama_stack_client import LlamaStackClient

from myloware.api.dependencies import (
    get_artifact_repo,
    get_llama_client,
    get_run_repo,
    get_vector_db_id,
)
from myloware.api.schemas import CallbackResponse, ErrorResponse, TelegramWebhookResponse
from myloware.agents.supervisor import create_supervisor_agent
from myloware.config import settings
from myloware.notifications.telegram import TelegramNotifier
from myloware.observability.logging import get_logger
from myloware.storage.repositories import ArtifactRepository, RunRepository
from myloware.workflows.langgraph.hitl import resume_hitl_gate

logger = get_logger(__name__)

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


@router.post(
    "/webhook",
    response_model=TelegramWebhookResponse,
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def telegram_webhook(
    request: Request,
    client: LlamaStackClient = Depends(get_llama_client),
) -> TelegramWebhookResponse:
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
        return TelegramWebhookResponse(ok=True, status="ignored", reason="duplicate")

    try:
        supervisor = await run_in_threadpool(create_supervisor_agent, client)
        session_id = f"telegram-{chat_id}"

        # Create session for supervisor
        actual_session_id = await run_in_threadpool(supervisor.create_session, session_id)

        try:
            response = await run_in_threadpool(
                supervisor.create_turn,
                messages=[{"role": "user", "content": f"From {username}: {message_text}"}],
                session_id=actual_session_id,
            )
            content = getattr(response, "completion_message", None)
            text = getattr(content, "content", "") if content else str(response)
        finally:
            # Clean up session (official Llama Stack pattern)
            try:
                await run_in_threadpool(
                    client.conversations.delete, conversation_id=actual_session_id
                )
            except Exception as cleanup_exc:
                logger.debug(
                    "Failed to delete conversation during cleanup",
                    extra={
                        "conversation_id": actual_session_id,
                        "error": str(cleanup_exc),
                        "error_type": type(cleanup_exc).__name__,
                    },
                )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Supervisor handling failed: %s", exc)
        text = "Sorry, something went wrong processing your request."

    await send_telegram_message(chat_id, text)

    return TelegramWebhookResponse(ok=True, status="ok")


@router.post("/callback", response_model=CallbackResponse)
async def telegram_callback(
    request: Request,
    run_repo: RunRepository = Depends(get_run_repo),
    artifact_repo: ArtifactRepository = Depends(get_artifact_repo),
    client: LlamaStackClient = Depends(get_llama_client),
    vector_db_id: str = Depends(get_vector_db_id),
) -> CallbackResponse:
    """Handle Telegram callback queries (inline button clicks)."""

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    callback_query = body.get("callback_query")
    if not callback_query:
        return CallbackResponse(ok=True)

    callback_id = callback_query.get("id")
    data = callback_query.get("data", "")
    chat_id = str(callback_query.get("message", {}).get("chat", {}).get("id", ""))

    parts = data.split(":")
    if len(parts) != 3:
        await _answer_callback(callback_id, "Invalid callback data")
        return CallbackResponse(ok=True, error="invalid_callback")

    action, run_id_str, gate = parts
    notifier = TelegramNotifier()

    try:
        run_uuid = UUID(run_id_str)
    except Exception:
        await _answer_callback(callback_id, "Invalid run id")
        return CallbackResponse(ok=True, error="invalid_run")

    if action == "approve":
        try:
            if gate not in {"ideation", "publish"}:
                await _answer_callback(callback_id, "Unknown gate")
                return CallbackResponse(ok=True, error="unknown_gate")

            if settings.workflow_dispatcher == "db" and not settings.disable_background_workflows:
                # Commit gate audit updates before enqueueing async resume work.
                try:
                    run_repo.session.commit()
                except Exception:
                    logger.warning("Failed to commit gate approval before enqueue", exc_info=True)

                from myloware.storage.database import get_async_session_factory
                from myloware.storage.repositories import JobRepository
                from myloware.workers.job_types import JOB_LANGGRAPH_HITL_RESUME

                SessionLocal = get_async_session_factory()
                async with SessionLocal() as async_session:
                    job_repo = JobRepository(async_session)
                    idem = (
                        f"telegram_cb:{callback_id}"
                        if callback_id
                        else f"telegram:{run_id_str}:{gate}:approve"
                    )
                    try:
                        await job_repo.enqueue_async(
                            JOB_LANGGRAPH_HITL_RESUME,
                            run_id=run_uuid,
                            payload={"gate": gate, "approved": True},
                            idempotency_key=idem,
                            max_attempts=settings.job_max_attempts,
                        )
                    except ValueError:
                        pass
                    await async_session.commit()

                await _answer_callback(callback_id, f"{gate} queued")
                await notifier.send_message(
                    chat_id,
                    "Gate <code>{gate}</code> approved for run <code>{run_id}</code>. "
                    "Queued for processing. Check status via <code>/v1/runs/{run_id}</code>.".format(
                        gate=gate, run_id=run_id_str
                    ),
                )
                return CallbackResponse(ok=True)

            result = await resume_hitl_gate(
                run_uuid,
                gate=gate,  # type: ignore[arg-type]
                approved=True,
            )

            await _answer_callback(callback_id, f"{gate} approved")
            await notifier.send_message(
                chat_id,
                "Gate <code>{gate}</code> approved for run <code>{run_id}</code>. "
                "Status: <code>{status}</code> (step: <code>{step}</code>).".format(
                    gate=gate,
                    run_id=run_id_str,
                    status=str(getattr(result, "status", "")),
                    step=str(getattr(result, "current_step", "")),
                ),
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Callback approve failed: %s", exc)
            await _answer_callback(callback_id, "Failed to approve")
            return CallbackResponse(ok=True, error="approve_failed")

    elif action == "reject":
        try:
            if gate not in {"ideation", "publish"}:
                await _answer_callback(callback_id, "Unknown gate")
                return CallbackResponse(ok=True, error="unknown_gate")

            if settings.workflow_dispatcher == "db" and not settings.disable_background_workflows:
                try:
                    run_repo.session.commit()
                except Exception:
                    logger.warning("Failed to commit gate rejection before enqueue", exc_info=True)

                from myloware.storage.database import get_async_session_factory
                from myloware.storage.repositories import JobRepository
                from myloware.workers.job_types import JOB_LANGGRAPH_HITL_RESUME

                SessionLocal = get_async_session_factory()
                async with SessionLocal() as async_session:
                    job_repo = JobRepository(async_session)
                    idem = (
                        f"telegram_cb:{callback_id}"
                        if callback_id
                        else f"telegram:{run_id_str}:{gate}:reject"
                    )
                    try:
                        await job_repo.enqueue_async(
                            JOB_LANGGRAPH_HITL_RESUME,
                            run_id=run_uuid,
                            payload={
                                "gate": gate,
                                "approved": False,
                                "comment": "Rejected via Telegram",
                            },
                            idempotency_key=idem,
                            max_attempts=settings.job_max_attempts,
                        )
                    except ValueError:
                        pass
                    await async_session.commit()

                await _answer_callback(callback_id, "Queued cancellation")
                await notifier.send_message(
                    chat_id,
                    "Run <code>{run_id}</code> rejection queued (gate: <code>{gate}</code>). "
                    "Check status via <code>/v1/runs/{run_id}</code>.".format(
                        run_id=run_id_str, gate=gate
                    ),
                )
                return CallbackResponse(ok=True)

            result = await resume_hitl_gate(
                run_uuid,
                gate=gate,  # type: ignore[arg-type]
                approved=False,
                comment="Rejected via Telegram",
            )

            await _answer_callback(callback_id, "Run cancelled")
            await notifier.send_message(
                chat_id,
                "Run <code>{run_id}</code> rejected. Status: <code>{status}</code>.".format(
                    run_id=run_id_str,
                    status=str(getattr(result, "status", "")),
                ),
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Callback reject failed: %s", exc)
            await _answer_callback(callback_id, "Failed to reject")
            return CallbackResponse(ok=True, error="reject_failed")
    else:
        await _answer_callback(callback_id, "Unknown action")
        return {"ok": True, "error": "unknown_action"}

    return CallbackResponse(ok=True)
