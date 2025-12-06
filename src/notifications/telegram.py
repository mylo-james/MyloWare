"""Telegram notification service."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from config import settings

logger = logging.getLogger("notifications.telegram")

__all__ = ["TelegramNotifier", "NotificationResult"]


@dataclass
class NotificationResult:
    """Result of sending a notification."""

    success: bool
    message_id: Optional[int] = None
    error: Optional[str] = None


class TelegramNotifier:
    """Send notifications to Telegram users."""

    def __init__(self, bot_token: str | None = None):
        token = settings.telegram_bot_token if bot_token is None else bot_token
        self.bot_token = token
        self.api_base = f"https://api.telegram.org/bot{token}" if token else None

    async def send_message(
        self,
        chat_id: str,
        text: str,
        *,
        parse_mode: str = "HTML",
        reply_markup: dict[str, Any] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> NotificationResult:
        """Send a text message.

        Args:
            chat_id: Telegram chat ID
            text: Message text (supports HTML)
            parse_mode: Telegram parse mode
            reply_markup: Optional inline keyboard
            client: Optional pre-configured HTTP client (useful for testing)
        """

        if not self.bot_token or not self.api_base:
            logger.error("Telegram bot token not configured")
            return NotificationResult(success=False, error="No bot token")

        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }

        if reply_markup:
            payload["reply_markup"] = reply_markup

        async def _post(active_client: httpx.AsyncClient) -> NotificationResult:
            try:
                response = await active_client.post(
                    f"{self.api_base}/sendMessage",
                    json=payload,
                )
                data = response.json()

                if data.get("ok"):
                    return NotificationResult(
                        success=True,
                        message_id=data.get("result", {}).get("message_id"),
                    )

                return NotificationResult(
                    success=False,
                    error=data.get("description", "Unknown error"),
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception("Failed to send Telegram message")
                return NotificationResult(success=False, error=str(exc))

        if client is not None:
            return await _post(client)

        async with httpx.AsyncClient(timeout=10) as async_client:
            return await _post(async_client)

    async def send_run_started(
        self,
        chat_id: str,
        run_id: str,
        project: str,
    ) -> NotificationResult:
        """Notify user that a run has started."""

        text = (
            "🚀 <b>Run Started</b>\n\n"
            f"<b>Project:</b> {project}\n"
            f"<b>Run ID:</b> <code>{run_id}</code>\n\n"
            "I'll keep you updated on progress!"
        )

        return await self.send_message(chat_id, text)

    async def send_hitl_request(
        self,
        chat_id: str,
        run_id: str,
        gate: str,
        content_preview: str,
    ) -> NotificationResult:
        """Send HITL approval request with inline buttons."""

        gate_display = "Ideation Review" if gate == "ideation" else "Pre-Publish Review"

        preview = content_preview or ""
        if len(preview) > 500:
            preview = preview[:500] + "..."

        text = (
            f"⏸️ <b>{gate_display} Required</b>\n\n"
            f"<b>Run ID:</b> <code>{run_id}</code>\n\n"
            f"<b>Preview:</b>\n{preview}\n\n"
            "Reply with:\n"
            f"• <code>approve {run_id}</code> to continue\n"
            f"• <code>reject {run_id}</code> to cancel"
        )

        reply_markup = {
            "inline_keyboard": [
                [
                    {
                        "text": "✅ Approve",
                        "callback_data": f"approve:{run_id}:{gate}",
                    },
                    {
                        "text": "❌ Reject",
                        "callback_data": f"reject:{run_id}:{gate}",
                    },
                ]
            ]
        }

        return await self.send_message(chat_id, text, reply_markup=reply_markup)

    async def send_run_completed(
        self,
        chat_id: str,
        run_id: str,
        published_url: str,
    ) -> NotificationResult:
        """Notify user that run completed successfully."""

        text = (
            "✅ <b>Run Completed!</b>\n\n"
            f"<b>Run ID:</b> <code>{run_id}</code>\n\n"
            "🎬 <b>Published:</b>\n"
            f"{published_url}\n\n"
            "Great work! Your video is now live."
        )

        return await self.send_message(chat_id, text)

    async def send_run_failed(
        self,
        chat_id: str,
        run_id: str,
        error: str,
        step: str | None = None,
    ) -> NotificationResult:
        """Notify user that run failed."""

        step_info = f" at <code>{step}</code>" if step else ""
        preview_error = error or "Unknown error"
        if len(preview_error) > 300:
            preview_error = preview_error[:300] + "..."

        text = (
            f"❌ <b>Run Failed{step_info}</b>\n\n"
            f"<b>Run ID:</b> <code>{run_id}</code>\n\n"
            f"<b>Error:</b>\n{preview_error}\n\n"
            "You can try again or contact support."
        )

        return await self.send_message(chat_id, text)

    async def send_status_update(
        self,
        chat_id: str,
        run_id: str,
        status: str,
        current_step: str,
    ) -> NotificationResult:
        """Send periodic status update."""

        step_emoji = {
            "ideator": "💡",
            "producer": "🎬",
            "editor": "✂️",
            "publisher": "📤",
        }
        emoji = step_emoji.get(current_step, "⏳")

        text = (
            f"{emoji} <b>Status Update</b>\n\n"
            f"<b>Run ID:</b> <code>{run_id}</code>\n"
            f"<b>Status:</b> {status}\n"
            f"<b>Current Step:</b> {current_step}"
        )

        return await self.send_message(chat_id, text)
