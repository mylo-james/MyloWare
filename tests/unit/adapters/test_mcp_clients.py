from __future__ import annotations

import json
from typing import Any

import pytest

from adapters.orchestration.mcp_bridge import MCPBridge
from adapters.orchestration.mcp_client import MCPClient


class DummyResponse:
    def __init__(self, *, status_code: int = 200, payload: Any = None, reason_phrase: str = "OK") -> None:
        self.status_code = status_code
        self._payload = payload
        self.reason_phrase = reason_phrase

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> Any:
        return self._payload

    @property
    def text(self) -> str:
        if isinstance(self._payload, (dict, list)):
            return json.dumps(self._payload)
        return str(self._payload) if self._payload is not None else ""


def test_mcp_bridge_video_generate_builds_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    class FakeHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, url: str, headers: dict[str, str], content: str) -> DummyResponse:
            calls.append({"url": url, "headers": headers, "content": json.loads(content)})
            return DummyResponse(payload={"status": "ok"})

        def close(self) -> None:
            return None

    monkeypatch.setattr("adapters.orchestration.mcp_bridge.httpx.Client", FakeHttpClient)

    bridge = MCPBridge(base_url="https://mcp.local/api", api_key="secret")
    result = bridge.video_generate(trace_id="abc", provider="shotstack", items=[{"id": 1}], persona="iggy", dry_run=True)

    assert result["status"] == "ok"
    assert calls
    request = calls[0]
    assert request["url"].endswith("/api/tools/video/generate")
    assert request["headers"]["x-api-key"] == "secret"
    assert request["content"]["traceId"] == "abc"
    assert request["content"]["caller"] == {"persona": "iggy"}
    assert request["content"]["dryRun"] is True
    assert request["content"]["items"] == [{"id": 1}]


def test_mcp_bridge_publish_includes_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: dict[str, Any] = {}

    class FakeHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, url: str, headers: dict[str, str], content: str) -> DummyResponse:
            posted["url"] = url
            posted["body"] = json.loads(content)
            return DummyResponse(payload={"status": "queued"})

        def close(self) -> None:
            return None

    monkeypatch.setattr("adapters.orchestration.mcp_bridge.httpx.Client", FakeHttpClient)

    bridge = MCPBridge(base_url="https://mcp.local/api", api_key=None)
    metadata = {"caption": "hello"}
    response = bridge.publish_tiktok(trace_id="run-1", provider="upload-post", items=[{"url": "video.mp4"}], metadata=metadata)

    assert response["status"] == "queued"
    assert posted["url"].endswith("/api/tools/publish/tiktok")
    assert posted["body"]["metadata"] == metadata
    assert posted["body"]["provider"] == "upload-post"


def test_mcp_bridge_video_generate_raises_on_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, url: str, headers: dict[str, str], content: str) -> DummyResponse:
            # Simulate an upstream HTTP error that triggers raise_for_status.
            return DummyResponse(status_code=500, payload={"error": "boom"}, reason_phrase="Internal Server Error")

        def close(self) -> None:
            return None

    monkeypatch.setattr("adapters.orchestration.mcp_bridge.httpx.Client", FailingHttpClient)

    bridge = MCPBridge(base_url="https://mcp.local/api", api_key="secret")

    with pytest.raises(RuntimeError):
        bridge.video_generate(trace_id="abc", provider="shotstack", items=[{"id": 1}], persona="iggy", dry_run=False)


def test_mcp_client_returns_structured_content(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, url: str, headers: dict[str, str], content: str) -> DummyResponse:
            assert headers["x-api-key"] == "key"
            return DummyResponse(payload={"structuredContent": {"result": "ok"}})

        def close(self) -> None:
            return None

    monkeypatch.setattr("adapters.orchestration.mcp_client.httpx.Client", FakeHttpClient)

    client = MCPClient(base_url="https://mcp.local", api_key="key")
    result = client.call("tools/demo", {"foo": "bar"})
    assert result == {"result": "ok"}


def test_mcp_client_raises_on_invalid_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, *args: Any, **kwargs: Any) -> DummyResponse:
            return DummyResponse(payload="not-json")

        def close(self) -> None:
            return None

    monkeypatch.setattr("adapters.orchestration.mcp_client.httpx.Client", FakeHttpClient)

    client = MCPClient(base_url="https://mcp.local", api_key=None)
    with pytest.raises(RuntimeError):
        client.call("tools/demo", {})


def test_mcp_client_raises_on_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeHttpClient:
        def __init__(self, *_, **__):
            return None

        def post(self, *args: Any, **kwargs: Any) -> DummyResponse:
            return DummyResponse(
                status_code=500,
                payload={"error": {"message": "boom"}},
                reason_phrase="Internal Server Error",
            )

        def close(self) -> None:
            return None

    monkeypatch.setattr("adapters.orchestration.mcp_client.httpx.Client", FakeHttpClient)

    client = MCPClient(base_url="https://mcp.local", api_key=None)
    with pytest.raises(RuntimeError) as exc:
        client.call("tools/demo", {})
    assert "boom" in str(exc.value)
