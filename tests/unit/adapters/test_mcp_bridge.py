from __future__ import annotations

import json

from adapters.orchestration.mcp_bridge import MCPBridge


class DummyResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:  # pragma: no cover - no error path in tests
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class DummyClient:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.calls: list[dict[str, object]] = []

    def post(self, url: str, headers: dict[str, str], content: str) -> DummyResponse:
        body = json.loads(content)
        self.calls.append({"url": url, "headers": headers, "body": body})
        return DummyResponse(self.payload)


def test_video_generate_posts_payload_with_persona_and_metadata() -> None:
    bridge = MCPBridge(base_url="https://bridge.local", api_key="abc")
    fake_client = DummyClient({"status": "ok"})
    bridge._client = fake_client  # type: ignore[attr-defined]

    result = bridge.video_generate(
        trace_id="trace-1",
        provider="shotstack",
        items=[{"id": 1, "timeline": {}}],
        persona="riley",
        dry_run=True,
        metadata={"runId": "run-1"},
    )

    call = fake_client.calls[0]
    assert call["url"] == "https://bridge.local/api/tools/video/generate"
    assert call["headers"]["x-api-key"] == "abc"
    assert call["body"]["caller"] == {"persona": "riley"}
    assert call["body"]["metadata"] == {"runId": "run-1"}
    assert call["body"]["dryRun"] is True
    assert call["body"]["items"] == [{"id": 1, "timeline": {}}]
    assert result == {"status": "ok"}


def test_video_edit_respects_dry_run_flag() -> None:
    bridge = MCPBridge(base_url="https://bridge.local")
    fake_client = DummyClient({"edit": True})
    bridge._client = fake_client  # type: ignore[attr-defined]

    bridge.video_edit(
        trace_id="trace-2",
        provider="editor",
        items=[{"id": "clip-1"}],
        dry_run=False,
    )

    call = fake_client.calls[0]
    assert call["url"].endswith("/api/tools/video/edit")
    assert call["body"]["dryRun"] is False
    assert call["body"]["kind"] == "edit"


def test_publish_tiktok_omits_persona_when_absent() -> None:
    bridge = MCPBridge(base_url="https://bridge.local")
    fake_client = DummyClient({"publish": True})
    bridge._client = fake_client  # type: ignore[attr-defined]

    bridge.publish_tiktok(
        trace_id="trace-3",
        provider="upload-post",
        items=[{"id": "clip-9"}],
        metadata={"channel": "@codex"},
    )

    call = fake_client.calls[0]
    assert call["url"].endswith("/api/tools/publish/tiktok")
    assert call["body"]["caller"] == {}
    assert call["body"]["metadata"] == {"channel": "@codex"}
