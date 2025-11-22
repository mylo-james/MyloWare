from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from adapters.ai_providers.shotstack.client import ShotstackClient
from adapters.persistence.cache.response_cache import ResponseCache


class StubResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:  # noqa: D401
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


def test_shotstack_render_uses_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[dict[str, Any]] = []

    class FakeHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> StubResponse:
            calls.append({"url": url, "json": json, "headers": headers})
            return StubResponse({"url": "https://shotstack.example/render.mp4", "response": {"status": "done"}})

        def get(self, *args: Any, **kwargs: Any) -> None:
            raise AssertionError("GET should not be called when result is cached")

        def close(self) -> None:
            return None

    monkeypatch.setattr(
        "adapters.ai_providers.shotstack.client.httpx.Client",
        FakeHttpClient,
    )

    run_calls: list[str] = []

    def fake_run_with_retry(fn):
        run_calls.append("called")
        return fn()

    monkeypatch.setattr("adapters.ai_providers.shotstack.client.run_with_retry", fake_run_with_retry)

    cache = ResponseCache(tmp_path / "cache")
    client = ShotstackClient(
        api_key="key",
        base_url="https://api.shotstack.io/v1",
        cache=cache,
    )

    timeline = {"timeline": {"tracks": []}}
    first = client.render(timeline)
    second = client.render(timeline)

    assert first == second
    assert len(run_calls) == 1, "render should hit Shotstack only once when cached"
    assert len(calls) == 1, "Shotstack POST should be invoked once when cache is warm"


def test_shotstack_render_polls_until_success(monkeypatch: pytest.MonkeyPatch) -> None:
    get_calls: list[str] = []

    class FakeHttpClient:
        def __init__(self, *_, **__):
            self._poll_responses = [
                StubResponse({"response": {"status": "processing"}}),
                StubResponse(
                    {
                        "response": {"status": "done", "url": "https://shotstack.example/render.mp4"},
                    }
                ),
            ]

        def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> StubResponse:
            return StubResponse({"response": {"id": "job-123", "status": "queued"}})

        def get(self, url: str, headers: dict[str, str]) -> StubResponse:
            get_calls.append(url)
            return self._poll_responses.pop(0)

        def close(self) -> None:
            return None

    monkeypatch.setattr(
        "adapters.ai_providers.shotstack.client.httpx.Client",
        FakeHttpClient,
    )

    def fake_run_with_retry(fn):
        return fn()

    monkeypatch.setattr("adapters.ai_providers.shotstack.client.run_with_retry", fake_run_with_retry)

    client = ShotstackClient(
        api_key="key",
        base_url="https://api.shotstack.io/v1",
        cache=None,
        poll_interval=0.0,
    )

    result = client.render({"timeline": {"output": "video"}})

    assert result["url"] == "https://shotstack.example/render.mp4"
    assert result["renderId"] == "job-123"
    assert result["response"]["id"] == "job-123"
    assert get_calls, "expected poll loop to call GET at least once"


def test_shotstack_render_handles_render_id_in_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """Queued responses that use renderId instead of id should still be handled."""
    get_calls: list[str] = []

    class FakeHttpClient:
        def __init__(self, *_, **__):
            self._poll_responses = [
                StubResponse({"response": {"status": "processing"}}),
                StubResponse(
                    {
                        "response": {"status": "done", "url": "https://shotstack.example/render2.mp4"},
                    }
                ),
            ]

        def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> StubResponse:
            # Simulate a QueuedResponse that exposes renderId but not id.
            return StubResponse({"response": {"renderId": "job-456", "status": "queued"}})

        def get(self, url: str, headers: dict[str, str]) -> StubResponse:
            get_calls.append(url)
            return self._poll_responses.pop(0)

        def close(self) -> None:
            return None

    monkeypatch.setattr(
        "adapters.ai_providers.shotstack.client.httpx.Client",
        FakeHttpClient,
    )

    def fake_run_with_retry(fn):
        return fn()

    monkeypatch.setattr("adapters.ai_providers.shotstack.client.run_with_retry", fake_run_with_retry)

    client = ShotstackClient(
        api_key="key",
        base_url="https://api.shotstack.io/v1",
        cache=None,
        poll_interval=0.0,
    )

    result = client.render({"timeline": {"output": "video"}})

    assert result["url"] == "https://shotstack.example/render2.mp4"
    assert result["renderId"] == "job-456"
    assert get_calls, "expected poll loop to call GET at least once"


def test_shotstack_client_validates_allowed_hosts(monkeypatch: pytest.MonkeyPatch) -> None:
    class NoopClient:
        def __init__(self, *_, **__):
            return None

        def close(self) -> None:
            return None

    monkeypatch.setattr(
        "adapters.ai_providers.shotstack.client.httpx.Client",
        NoopClient,
    )

    # Allowed host should construct without error.
    ShotstackClient(api_key="key", base_url="https://api.shotstack.io/v1")

    # Disallowed host should raise when dev hosts aren't permitted.
    with pytest.raises(ValueError):
        ShotstackClient(api_key="key", base_url="https://evil.example.com", allow_dev_hosts=False)
