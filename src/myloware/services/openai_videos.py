"""OpenAI video content helpers."""

from __future__ import annotations

import asyncio
import secrets
import tempfile
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import httpx

from myloware.config import settings
from myloware.observability.logging import get_logger

_OPENAI_VIDEO_CONTENT_TIMEOUT = httpx.Timeout(60.0, read=300.0)
_OPENAI_VIDEO_STATUS_TIMEOUT = httpx.Timeout(10.0, read=30.0)
_OPENAI_VIDEO_DOWNLOAD_MAX_ATTEMPTS = 3
_OPENAI_VIDEO_DOWNLOAD_BASE_DELAY_S = 1.0
_OPENAI_VIDEO_DOWNLOAD_MAX_DELAY_S = 30.0

logger = get_logger(__name__)


def _retry_jitter_seconds() -> float:
    """Return a small jitter delay for retry backoff."""
    return secrets.randbelow(250) / 1000.0


def _should_retry_status(status_code: int) -> bool:
    # Retry common transient errors only.
    if status_code == 429:
        return True
    if status_code in {408, 409}:
        return True
    return 500 <= status_code <= 599


def _retry_after_seconds(headers: httpx.Headers) -> float | None:
    """Parse RFC-compliant Retry-After (seconds or HTTP-date)."""
    raw = headers.get("Retry-After") or headers.get("retry-after")
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    try:
        seconds = int(value)
    except ValueError:
        seconds = None
    if seconds is not None:
        return max(0.0, float(seconds))
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    delta = (dt - datetime.now(tz=UTC)).total_seconds()
    return max(0.0, float(delta))


async def download_openai_video_content_to_tempfile(video_id: str) -> Path:
    """Download OpenAI video content to a temporary file and return its path."""
    video_id = (video_id or "").strip()
    if not video_id:
        raise ValueError("Missing video_id for OpenAI download")

    api_key = str(getattr(settings, "openai_api_key", "") or "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required to download OpenAI video content")

    url = f"https://api.openai.com/v1/videos/{video_id}/content"
    headers = {"Authorization": f"Bearer {api_key}"}

    last_exc: Exception | None = None
    for attempt in range(_OPENAI_VIDEO_DOWNLOAD_MAX_ATTEMPTS):
        downloaded: Path | None = None
        try:
            async with httpx.AsyncClient(timeout=_OPENAI_VIDEO_CONTENT_TIMEOUT) as client:
                async with client.stream("GET", url, headers=headers) as resp:
                    resp.raise_for_status()
                    with tempfile.NamedTemporaryFile(
                        prefix="openai_video_", suffix=".mp4", delete=False
                    ) as tmp:
                        downloaded = Path(tmp.name)
                        async for chunk in resp.aiter_bytes():
                            tmp.write(chunk)
            if downloaded is None:
                raise RuntimeError("OpenAI video download failed: missing tempfile")
            return downloaded
        except httpx.HTTPStatusError as exc:
            if downloaded is not None:
                try:
                    downloaded.unlink(missing_ok=True)
                except Exception:
                    logger.debug("openai_video_download_cleanup_failed", video_id=video_id)
            status_code = int(getattr(exc.response, "status_code", 0) or 0)
            retryable = _should_retry_status(status_code)
            if attempt < _OPENAI_VIDEO_DOWNLOAD_MAX_ATTEMPTS - 1 and retryable:
                retry_after = _retry_after_seconds(exc.response.headers)
                delay = (
                    retry_after
                    if retry_after is not None
                    else _OPENAI_VIDEO_DOWNLOAD_BASE_DELAY_S * (2**attempt)
                )
                delay = min(_OPENAI_VIDEO_DOWNLOAD_MAX_DELAY_S, max(0.0, float(delay)))
                # Small jitter to avoid thundering herd when multiple clips retry.
                delay += _retry_jitter_seconds()
                logger.warning(
                    "openai_video_download_retry",
                    video_id=video_id,
                    attempt=attempt + 1,
                    status_code=status_code,
                    delay_s=delay,
                )
                await asyncio.sleep(delay)
                last_exc = exc
                continue
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            if downloaded is not None:
                try:
                    downloaded.unlink(missing_ok=True)
                except Exception:
                    logger.debug("openai_video_download_cleanup_failed", video_id=video_id)
            if attempt < _OPENAI_VIDEO_DOWNLOAD_MAX_ATTEMPTS - 1:
                delay = _OPENAI_VIDEO_DOWNLOAD_BASE_DELAY_S * (2**attempt)
                delay = min(_OPENAI_VIDEO_DOWNLOAD_MAX_DELAY_S, max(0.0, float(delay)))
                delay += _retry_jitter_seconds()
                logger.warning(
                    "openai_video_download_retry",
                    video_id=video_id,
                    attempt=attempt + 1,
                    error=str(exc),
                    delay_s=delay,
                )
                await asyncio.sleep(delay)
                last_exc = exc
                continue
            raise
        except Exception as exc:  # pragma: no cover - defensive fallback
            if downloaded is not None:
                try:
                    downloaded.unlink(missing_ok=True)
                except Exception:
                    logger.debug("openai_video_download_cleanup_failed", video_id=video_id)
            last_exc = exc
            break

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("OpenAI video download failed")


async def retrieve_openai_video_job(video_id: str) -> dict[str, Any]:
    """Retrieve OpenAI video job metadata (status/progress) for polling fallbacks."""
    video_id = (video_id or "").strip()
    if not video_id:
        raise ValueError("Missing video_id for OpenAI status retrieval")

    api_key = str(getattr(settings, "openai_api_key", "") or "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required to retrieve OpenAI video job status")

    url = f"https://api.openai.com/v1/videos/{video_id}"
    headers = {"Authorization": f"Bearer {api_key}"}

    last_exc: Exception | None = None
    for attempt in range(_OPENAI_VIDEO_DOWNLOAD_MAX_ATTEMPTS):
        try:
            async with httpx.AsyncClient(timeout=_OPENAI_VIDEO_STATUS_TIMEOUT) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                payload = resp.json()
            if not isinstance(payload, dict):
                raise ValueError("OpenAI video status response must be an object")
            return payload
        except httpx.HTTPStatusError as exc:
            status_code = int(getattr(exc.response, "status_code", 0) or 0)
            retryable = _should_retry_status(status_code)
            if attempt < _OPENAI_VIDEO_DOWNLOAD_MAX_ATTEMPTS - 1 and retryable:
                retry_after = _retry_after_seconds(exc.response.headers)
                delay = (
                    retry_after
                    if retry_after is not None
                    else _OPENAI_VIDEO_DOWNLOAD_BASE_DELAY_S * (2**attempt)
                )
                delay = min(_OPENAI_VIDEO_DOWNLOAD_MAX_DELAY_S, max(0.0, float(delay)))
                delay += _retry_jitter_seconds()
                logger.warning(
                    "openai_video_status_retry",
                    video_id=video_id,
                    attempt=attempt + 1,
                    status_code=status_code,
                    delay_s=delay,
                )
                await asyncio.sleep(delay)
                last_exc = exc
                continue
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            if attempt < _OPENAI_VIDEO_DOWNLOAD_MAX_ATTEMPTS - 1:
                delay = _OPENAI_VIDEO_DOWNLOAD_BASE_DELAY_S * (2**attempt)
                delay = min(_OPENAI_VIDEO_DOWNLOAD_MAX_DELAY_S, max(0.0, float(delay)))
                delay += _retry_jitter_seconds()
                logger.warning(
                    "openai_video_status_retry",
                    video_id=video_id,
                    attempt=attempt + 1,
                    error=str(exc),
                    delay_s=delay,
                )
                await asyncio.sleep(delay)
                last_exc = exc
                continue
            raise
        except Exception as exc:  # pragma: no cover - defensive fallback
            last_exc = exc
            break

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("OpenAI video status retrieval failed")
