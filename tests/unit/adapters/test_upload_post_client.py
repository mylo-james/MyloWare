from __future__ import annotations

from pathlib import Path
from typing import Any

import hashlib
import hmac

import httpx
import pytest

from adapters.persistence.cache.response_cache import ResponseCache
from adapters.social.upload_post.client import UploadPostClient


class StubResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:  # noqa: D401
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


def test_upload_post_publish_uses_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[dict[str, Any]] = []

    class FakeHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, url: str, files: list[tuple[str, Any]], headers: dict[str, str]) -> StubResponse:
            calls.append({"url": url, "files": files, "headers": headers})
            return StubResponse({"canonicalUrl": "https://tiktok.example/demo", "accountId": headers.get("x-social-account-id")})

        def close(self) -> None:
            return None

    def fake_run_with_retry(fn):
        return fn()

    monkeypatch.setattr("adapters.social.upload_post.client.httpx.Client", FakeHttpClient)
    monkeypatch.setattr("adapters.social.upload_post.client.run_with_retry", fake_run_with_retry)

    cache = ResponseCache(tmp_path / "cache")
    video_path = tmp_path / "demo.mp4"
    video_path.write_bytes(b"demo-bytes")

    client = UploadPostClient(
        api_key="key",
        base_url="https://api.upload-post.com/v1",
        signing_secret="secret",
        cache=cache,
    )

    first = client.publish(video_path=video_path, caption="My caption", account_id="AISMR", platforms=["tiktok"])
    second = client.publish(video_path=video_path, caption="My caption", account_id="AISMR", platforms=["tiktok"])

    assert first == second
    assert len(calls) == 1, "second publish should have been served from cache"
    assert calls[0]["headers"]["Authorization"].startswith("Apikey ")
    assert ("platform[]", (None, "tiktok")) in [entry[:2] for entry in calls[0]["files"]]


def test_upload_post_verify_signature(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("adapters.social.upload_post.client.httpx.Client", lambda *_, **__: None)

    client = UploadPostClient(
        api_key="key",
        base_url="https://api.upload-post.com/v1",
        signing_secret="secret",
    )

    payload = b'{"runId":"123"}'
    digest = hmac.new(b"secret", payload, hashlib.sha256).hexdigest()

    assert client.verify_signature(payload, digest) is True
    assert client.verify_signature(payload, "bad") is False
    assert client.verify_signature(payload, None) is False


def test_upload_post_handles_http_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class FailingClient:
        def __init__(self, *_, **__):
            return None

        def post(self, *args: Any, **kwargs: Any) -> StubResponse:
            raise httpx.HTTPError("failed publish")

        def close(self) -> None:
            return None

    video_path = tmp_path / "demo.mp4"
    video_path.write_bytes(b"demo")

    client = UploadPostClient(api_key="key", base_url="https://api.upload-post.com", signing_secret="secret")
    monkeypatch.setattr("adapters.social.upload_post.client.httpx.Client", lambda *_, **__: FailingClient())
    monkeypatch.setattr("adapters.social.upload_post.client.run_with_retry", lambda fn: fn())

    with pytest.raises(httpx.HTTPError):
        client.publish(video_path=video_path, caption="hi")
