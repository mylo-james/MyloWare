from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import hashlib
import hmac

import httpx
import pytest

from adapters.ai_providers.kieai.client import KieAIClient
from adapters.persistence.cache.response_cache import ResponseCache


class DummyResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


class FakeHttpClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> DummyResponse:
        self.calls.append({"url": url, "json": json, "headers": headers})
        return DummyResponse({"data": {"taskId": "job-123", "metadata": json.get("metadata", {})}})

    def close(self) -> None:
        return None


def test_submit_job_uses_cache_and_injects_run_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cache = ResponseCache(tmp_path / "cache")
    cache_key = {
        "prompt": "demo",
        "duration": 5,
        "quality": "720p",
        "aspect_ratio": "16:9",
        "model": "veo3",
        "metadata": {"videoIndex": 0},
    }
    cached_payload = {"data": {"taskId": "job-321", "metadata": {"videoIndex": 0}}}
    cache.set("kieai", cache_key, cached_payload)

    client = KieAIClient(
        api_key="key",
        base_url="https://api.kie.ai",
        signing_secret="secret",
        cache=cache,
    )
    monkeypatch.setattr(client, "_client", FakeHttpClient(), raising=False)

    result = client.submit_job(
        prompt="demo",
        run_id="run-abc",
        callback_url="https://callback",
        duration=5,
        aspect_ratio="16:9",
        quality="720p",
        model="veo3",
        metadata={"videoIndex": 0},
    )

    assert result["data"]["metadata"]["runId"] == "run-abc"
    assert result["data"]["runId"] == "run-abc"


def test_submit_job_persists_sanitized_response(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cache = ResponseCache(tmp_path / "cache")
    fake_http = FakeHttpClient()
    client = KieAIClient(
        api_key="key",
        base_url="https://api.kie.ai",
        signing_secret="secret",
        cache=cache,
    )
    monkeypatch.setattr(client, "_client", fake_http, raising=False)

    response = client.submit_job(
        prompt="demo",
        run_id="run-123",
        callback_url="https://callback",
        duration=5,
        aspect_ratio="16:9",
        quality="720p",
        model="veo3",
        metadata={"videoIndex": 1},
    )

    key = {
        "prompt": "demo",
        "duration": 5,
        "quality": "720p",
        "aspect_ratio": "16:9",
        "model": "veo3",
        "metadata": {"videoIndex": 1},
    }
    cached = cache.get("kieai", key)
    assert cached["data"]["taskId"] == "job-123"
    assert "runId" not in cached["data"].get("metadata", {})
    assert response["data"]["taskId"] == "job-123"
    assert fake_http.calls, "HTTP client should have been invoked"


def test_submit_job_includes_stable_idempotency_key(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_http = FakeHttpClient()
    client = KieAIClient(
        api_key="key",
        base_url="https://api.kie.ai",
        signing_secret="secret",
        cache=None,
    )
    monkeypatch.setattr(client, "_client", fake_http, raising=False)

    client.submit_job(
        prompt="demo",
        run_id="run-123",
        callback_url="https://callback",
        duration=5,
        aspect_ratio="16:9",
        quality="720p",
        model="veo3",
        metadata={"videoIndex": 7},
    )

    assert fake_http.calls, "expected HTTP call to be recorded"
    payload = fake_http.calls[0]["json"]
    key = payload.get("idempotencyKey")
    assert isinstance(key, str) and key, "idempotencyKey must be a non-empty string"
    # Key should be derived from the run id and video index so that retries
    # and duplicate webhook deliveries remain idempotent.
    assert "run-123" in key
    assert "7" in key


def test_submit_job_handles_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingClient:
        def post(self, *args: Any, **kwargs: Any) -> DummyResponse:
            raise httpx.HTTPError("boom")

        def close(self) -> None:
            return None

    client = KieAIClient(
        api_key="key",
        base_url="https://api.kie.ai",
        signing_secret="secret",
        cache=None,
    )
    monkeypatch.setattr(client, "_client", FailingClient(), raising=False)

    monkeypatch.setattr("adapters.ai_providers.kieai.client.run_with_retry", lambda fn: fn())
    with pytest.raises(httpx.HTTPError):
        client.submit_job(
            prompt="demo",
            run_id="run-err",
            callback_url="https://callback",
            duration=5,
            aspect_ratio="16:9",
            quality="720p",
            model="veo3",
        )


def test_submit_job_respects_circuit_breaker(monkeypatch: pytest.MonkeyPatch) -> None:
    fail_count = 0

    class FailingClient:
        def post(self, *args: Any, **kwargs: Any) -> DummyResponse:
            nonlocal fail_count
            fail_count += 1
            raise httpx.HTTPError("boom")

        def close(self) -> None:
            return None

    client = KieAIClient(
        api_key="key",
        base_url="https://api.kie.ai",
        signing_secret="secret",
    )
    monkeypatch.setattr("adapters.ai_providers.kieai.client.run_with_retry", lambda fn: fn())
    monkeypatch.setattr(client, "_client", FailingClient(), raising=False)

    with pytest.raises(httpx.HTTPError):
        client.submit_job(
            prompt="demo",
            run_id="run-breaker",
            callback_url="https://callback",
            duration=5,
            aspect_ratio="16:9",
            quality="720p",
            model="veo3",
        )
    assert fail_count == 1, "expect patched retry wrapper to execute once"


def test_verify_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    client = KieAIClient(
        api_key="key",
        base_url="https://api.kie.ai",
        signing_secret="secret",
    )
    payload = b'{"data":"demo"}'
    digest = hmac.new(b"secret", payload, hashlib.sha256).hexdigest()
    assert client.verify_signature(payload, digest) is True
    assert client.verify_signature(payload, "bad") is False
