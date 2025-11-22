from __future__ import annotations

from datetime import timedelta
from typing import Any

import httpx
import pytest

from apps.api.orchestrator_client import OrchestratorClient


class DummyResponse:
    def __init__(self, *, json_data: dict[str, Any], status_code: int = 200, url: str = "http://orchestrator/runs/run") -> None:
        self._json = json_data
        request = httpx.Request("POST", url)
        self._response = httpx.Response(status_code=status_code, request=request)
        self.status_code = status_code
        self.elapsed = timedelta(milliseconds=5)

    def raise_for_status(self) -> None:
        self._response.raise_for_status()

    def json(self) -> dict[str, Any]:
        return dict(self._json)


class FakeHTTPXClient:
    def __init__(self, responses: list[DummyResponse]):
        self._responses = responses
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def post(self, url: str, *, json: dict[str, Any] | None = None, params: dict[str, str] | None = None, headers: dict[str, str] | None = None) -> DummyResponse:
        self.calls.append({"url": url, "json": json, "params": params, "headers": headers})
        if not self._responses:
            raise AssertionError("No HTTPX responses configured")
        return self._responses.pop(0)

    def close(self) -> None:
        self.closed = True


def _install_fake_client(monkeypatch: pytest.MonkeyPatch, responses: list[DummyResponse]) -> FakeHTTPXClient:
    fake_client = FakeHTTPXClient(responses)
    monkeypatch.setattr("apps.api.orchestrator_client.httpx.Client", lambda *args, **kwargs: fake_client)
    return fake_client


def test_invoke_posts_payload_with_background(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = [DummyResponse(json_data={"status": "queued"}, url="http://graph/runs/run-123")]
    fake_client = _install_fake_client(monkeypatch, responses)
    client = OrchestratorClient(base_url="http://graph", api_key="secret")

    result = client.invoke("run-123", {"input": "hi"}, background=False)

    assert result == {"status": "queued"}
    assert fake_client.calls
    call = fake_client.calls[0]
    assert call["url"] == "http://graph/runs/run-123"
    assert call["params"] == {"background": "false"}
    assert call["headers"]["x-api-key"] == "secret"


def test_chat_brendan_raises_for_status(monkeypatch: pytest.MonkeyPatch) -> None:
    failing_response = DummyResponse(json_data={}, status_code=500, url="http://graph/v1/chat/brendan")
    fake_client = _install_fake_client(monkeypatch, [failing_response])
    client = OrchestratorClient(base_url="http://graph", api_key="secret")

    with pytest.raises(httpx.HTTPStatusError):
        client.chat_brendan(user_id="user-1", message="hello")

    assert fake_client.calls[0]["url"] == "http://graph/v1/chat/brendan"
