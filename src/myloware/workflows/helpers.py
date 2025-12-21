"""Shared helper functions for workflow operations."""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from myloware.config import settings
from myloware.notifications.telegram import TelegramNotifier
from myloware.observability.logging import get_logger
from myloware.storage.repositories import ArtifactRepository

logger = get_logger(__name__)


def fire_and_forget(coro: Any) -> None:
    """Run a coroutine without awaiting, handling absent event loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(coro)
        return
    task = loop.create_task(coro)

    def _log_task_result(task: asyncio.Task) -> None:
        try:
            task.result()
        except Exception as exc:  # pragma: no cover - best-effort logging
            logger.warning("fire_and_forget task failed: %s", exc)

    task.add_done_callback(_log_task_result)


# Removed run_async_from_sync - execute methods should be async instead


def extract_chat_id(run: Any) -> Optional[str]:
    """Extract Telegram chat id from run metadata."""
    if getattr(run, "telegram_chat_id", None):
        return run.telegram_chat_id

    meta = getattr(run, "metadata", None) or {}
    return meta.get("telegram_chat_id")


def notify_telegram(
    run: Any,
    notifier: TelegramNotifier | None,
    event: str,
    **kwargs: Any,
) -> None:
    """Fire-and-forget telegram notification."""
    if notifier is None:
        return

    chat_id = extract_chat_id(run)
    if not chat_id:
        return

    coro: Any = None

    if event == "started":
        coro = notifier.notify_run_started(chat_id, str(run.id))
    elif event == "hitl_required":
        gate = kwargs.get("gate", "approval")
        content = kwargs.get("content", "")
        coro = notifier.notify_hitl_required(chat_id, str(run.id), gate, content)
    elif event == "completed":
        coro = notifier.notify_run_completed(
            chat_id,
            str(run.id),
            kwargs.get("artifacts", {}),
        )
    elif event == "failed":
        coro = notifier.notify_run_failed(
            chat_id,
            str(run.id),
            kwargs.get("error", "Unknown error"),
            kwargs.get("step"),
        )
    elif event == "status_update":
        # Optional status update notification
        message = kwargs.get("message", "")
        if hasattr(notifier, "send_message"):
            coro = notifier.send_message(chat_id, message)

    if coro:
        fire_and_forget(coro)


def extract_trace_id(response: Any) -> Optional[str]:
    """Extract trace ID from Llama Stack response if available."""
    if hasattr(response, "trace_id"):
        return response.trace_id
    return None


def check_video_cache(
    artifact_repo: ArtifactRepository,
    topic: str,
    signs: list[str] | None = None,
    required_count: int = 12,
) -> tuple[list[str], list[str]]:
    """Check cache for existing videos matching topic/signs.

    Returns:
        Tuple of (cached_urls, missing_signs)
        - cached_urls: URLs of cached videos (may include repeats if < required_count)
        - missing_signs: Signs that need new video generation
    """
    if not settings.use_video_cache:
        return [], signs or []

    cached_artifacts = artifact_repo.find_cached_videos(topic, signs, limit=required_count)

    cached_urls = []
    cached_signs = set()

    for artifact in cached_artifacts:
        if artifact.uri:
            cached_urls.append(artifact.uri)
            sign = artifact.artifact_metadata.get("sign")
            if sign:
                cached_signs.add(sign)

    # Determine which signs need new videos
    if signs:
        missing_signs = [s for s in signs if s not in cached_signs]
    else:
        missing_signs = []

    # If we have fewer cached videos than required, we'll reuse/repeat
    if len(cached_urls) < required_count and cached_urls:
        logger.info(
            "Cache has %d videos for topic '%s', will reuse to fill %d slots",
            len(cached_urls),
            topic,
            required_count,
        )
        # Repeat cached videos to fill required count
        original_count = len(cached_urls)
        while len(cached_urls) < required_count:
            cached_urls.append(cached_urls[len(cached_urls) % original_count])

    logger.info(
        "Video cache check: topic='%s', cached=%d, missing=%d signs",
        topic,
        len(cached_artifacts),
        len(missing_signs),
    )

    return cached_urls, missing_signs
