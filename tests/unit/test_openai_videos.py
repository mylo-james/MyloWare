from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from myloware.config import settings
from myloware.services import openai_videos


def test_retry_helpers() -> None:
    assert openai_videos._should_retry_status(429) is True
    assert openai_videos._should_retry_status(500) is True
    assert openai_videos._should_retry_status(400) is False
    assert 0.0 <= openai_videos._retry_jitter_seconds() < 0.25

    headers = httpx.Headers({"Retry-After": "3"})
    assert openai_videos._retry_after_seconds(headers) == 3.0

    future = (datetime.now(tz=UTC) + timedelta(seconds=5)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    headers = httpx.Headers({"Retry-After": future})
    assert openai_videos._retry_after_seconds(headers) is not None
    assert openai_videos._retry_after_seconds(httpx.Headers({"Retry-After": "bad"})) is None


@pytest.mark.asyncio
async def test_download_openai_video_requires_video_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    with pytest.raises(ValueError):
        await openai_videos.download_openai_video_content_to_tempfile("")


@pytest.mark.asyncio
async def test_download_openai_video_requires_api_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "")
    with pytest.raises(ValueError):
        await openai_videos.download_openai_video_content_to_tempfile("vid_1")


class _FakeStreamResponse:
    def __init__(self, status_code: int = 200, headers: dict[str, str] | None = None, chunks=None):
        self.status_code = status_code
        self.headers = httpx.Headers(headers or {})
        self.request = httpx.Request("GET", "https://api.openai.com/v1/videos/x/content")
        self._chunks = chunks or [b"hello"]

    async def aiter_bytes(self):  # type: ignore[no-untyped-def]
        for chunk in self._chunks:
            yield chunk

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=self.request, response=self)


class _FakeStreamCM:
    def __init__(self, response: _FakeStreamResponse):
        self._response = response

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self._response

    async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
        return None


class _ResponseQueue:
    def __init__(self, responses):
        self._responses = list(responses)

    def next(self):
        return self._responses.pop(0)


class _FakeAsyncClient:
    def __init__(self, queue: _ResponseQueue):
        self._queue = queue

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
        return None

    def stream(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        item = self._queue.next()
        if isinstance(item, Exception):
            raise item
        return _FakeStreamCM(item)


@pytest.mark.asyncio
async def test_download_openai_video_success(monkeypatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    queue = _ResponseQueue([_FakeStreamResponse(chunks=[b"abc"])])

    monkeypatch.setattr(openai_videos.httpx, "AsyncClient", lambda *a, **k: _FakeAsyncClient(queue))

    path = await openai_videos.download_openai_video_content_to_tempfile("video_1")
    assert path.exists()
    try:
        assert Path(path).read_bytes() == b"abc"
    finally:
        path.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_download_openai_video_retries_then_succeeds(monkeypatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    queue = _ResponseQueue(
        [
            _FakeStreamResponse(status_code=500),
            _FakeStreamResponse(chunks=[b"ok"]),
        ]
    )

    monkeypatch.setattr(openai_videos.httpx, "AsyncClient", lambda *a, **k: _FakeAsyncClient(queue))
    monkeypatch.setattr(openai_videos, "_retry_jitter_seconds", lambda: 0.0)

    async def _sleep(_t):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(asyncio, "sleep", _sleep)

    path = await openai_videos.download_openai_video_content_to_tempfile("video_2")
    assert path.exists()
    path.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_download_openai_video_non_retryable_error(monkeypatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    queue = _ResponseQueue([_FakeStreamResponse(status_code=400)])
    monkeypatch.setattr(openai_videos.httpx, "AsyncClient", lambda *a, **k: _FakeAsyncClient(queue))

    with pytest.raises(httpx.HTTPStatusError):
        await openai_videos.download_openai_video_content_to_tempfile("video_3")


@pytest.mark.asyncio
async def test_download_openai_video_timeout_then_success(monkeypatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    queue = _ResponseQueue([httpx.TimeoutException("timeout"), _FakeStreamResponse()])
    monkeypatch.setattr(openai_videos.httpx, "AsyncClient", lambda *a, **k: _FakeAsyncClient(queue))
    monkeypatch.setattr(openai_videos, "_retry_jitter_seconds", lambda: 0.0)

    async def _sleep(_t):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(asyncio, "sleep", _sleep)

    path = await openai_videos.download_openai_video_content_to_tempfile("video_4")
    assert path.exists()
    path.unlink(missing_ok=True)
