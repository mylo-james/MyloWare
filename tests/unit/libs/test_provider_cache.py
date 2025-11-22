from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest

from adapters.persistence.cache import ResponseCache
from adapters.ai_providers.kieai.client import KieAIClient
from adapters.ai_providers.shotstack.client import ShotstackClient
from adapters.social.upload_post.client import UploadPostClient


class StubResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload
        self.raise_for_status_called = False

    def raise_for_status(self) -> None:
        self.raise_for_status_called = True

    def json(self) -> dict[str, Any]:
        return self._payload


def test_kieai_client_uses_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[dict[str, Any]] = []

    def fake_post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> StubResponse:  # type: ignore[no-untyped-def]
        payload = {
            "code": 200,
            "data": {
                "taskId": "stub-task",
                "runId": json["metadata"]["runId"],
                "metadata": json["metadata"],
            },
        }
        calls.append({"url": url, "json": json, "headers": headers})
        return StubResponse(payload)

    monkeypatch.setattr(httpx.Client, "post", fake_post)

    cache = ResponseCache(tmp_path / "providers")
    client = KieAIClient(
        api_key="test-key",
        base_url="https://api.test",
        signing_secret="secret",
        cache=cache,
    )

    kwargs = {
        "prompt": "demo prompt",
        "run_id": "run-123",
        "callback_url": "https://callback",
        "duration": 5,
        "aspect_ratio": "16:9",
        "quality": "720p",
        "model": "veo3",
        "metadata": {"videoIndex": 0},
    }

    first = client.submit_job(**kwargs)
    second = client.submit_job(**kwargs)

    assert calls, "expected at least one upstream call"
    assert len(calls) == 1, "cached invocation should avoid duplicate POST requests"
    assert first == second
    assert first["data"]["metadata"]["videoIndex"] == 0

    client.close()


def test_shotstack_client_uses_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[dict[str, Any]] = []

    def fake_post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> StubResponse:  # type: ignore[no-untyped-def]
        payload = {"url": "https://shotstack.example/render.mp4", "timeline": json}
        calls.append({"url": url, "json": json, "headers": headers})
        return StubResponse(payload)

    monkeypatch.setattr(httpx.Client, "post", fake_post)

    cache = ResponseCache(tmp_path / "providers")
    client = ShotstackClient(api_key="shotstack-key", base_url="https://shotstack.example", cache=cache)

    timeline = {"timeline": {"tracks": []}}

    first = client.render(timeline)
    second = client.render(timeline)

    assert len(calls) == 1, "render results should be cached after first success"
    assert first == second
    assert first["url"].startswith("https://shotstack.example/")
    # Provider calls should include an idempotency key so that retries are
    # safe at the provider boundary.
    assert "Idempotency-Key" in calls[0]["headers"]
    assert calls[0]["headers"]["Idempotency-Key"]

    client.close()


def test_uploadpost_client_uses_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[dict[str, Any]] = []

    def fake_post(self, url: str, *_, **kwargs: Any) -> StubResponse:  # type: ignore[no-untyped-def]
        files = kwargs.get("files", [])
        headers = kwargs.get("headers", {})
        form_lookup: dict[str, list[str]] = {}
        video_field = None
        for name, value in files:
            if name == "video":
                video_field = value
                continue
            if isinstance(value, tuple):
                _, content = value[0], value[1]
                form_lookup.setdefault(name, []).append(content)
            else:
                form_lookup.setdefault(name, []).append(value)
        payload = {
            "canonicalUrl": "https://tiktok.example/video123",
            "caption": form_lookup.get("caption", [""])[0],
            "accountId": headers.get("x-social-account-id"),
            "platforms": form_lookup.get("platform[]", []),
        }
        calls.append({"url": url, "files": files, "headers": headers, "video_field": video_field})
        return StubResponse(payload)

    monkeypatch.setattr(httpx.Client, "post", fake_post)

    cache = ResponseCache(tmp_path / "providers")
    client = UploadPostClient(
        api_key="test-key",
        base_url="https://api.upload-post.test",
        signing_secret="secret",
        cache=cache,
    )

    # Create a test video file
    video_file = tmp_path / "test_video.mp4"
    video_file.write_bytes(b"fake video content")

    first = client.publish(video_path=video_file, caption="Test caption", account_id="AISMR")
    second = client.publish(video_path=video_file, caption="Test caption", account_id="AISMR")

    assert len(calls) == 1, "cached publish should avoid duplicate POST requests"
    assert first == second
    assert first["canonicalUrl"] == "https://tiktok.example/video123"
    assert first["caption"] == "Test caption"
    assert first["accountId"] == "AISMR"
    # Provider calls should include an idempotency key header.
    assert "Idempotency-Key" in calls[0]["headers"]
    assert calls[0]["headers"]["Idempotency-Key"]

    client.close()
