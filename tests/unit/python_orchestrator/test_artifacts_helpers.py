from __future__ import annotations

from typing import Any

import pytest

from apps.orchestrator import artifacts


class DummyClient:
    def __init__(self) -> None:
        self.posts: list[dict[str, Any]] = []

    def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> None:
        self.posts.append({"url": url, "json": json, "headers": headers})


def test_record_artifacts_noop_when_sync_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    dummy = DummyClient()
    monkeypatch.setattr(artifacts, "_CLIENT", dummy, raising=False)
    monkeypatch.setattr(artifacts.settings, "artifact_sync_enabled", False, raising=False)

    artifacts.record_artifacts("run-123", [{"type": "x"}])

    assert dummy.posts == []


def test_record_artifacts_sends_payloads_to_api(monkeypatch: pytest.MonkeyPatch) -> None:
    dummy = DummyClient()
    monkeypatch.setattr(artifacts, "_CLIENT", dummy, raising=False)
    monkeypatch.setattr(artifacts.settings, "artifact_sync_enabled", True, raising=False)
    monkeypatch.setattr(artifacts.settings, "api_base_url", "https://api.example", raising=False)
    monkeypatch.setattr(artifacts.settings, "api_key", "secret-key", raising=False)

    artifacts.record_artifacts(
        "run-abc",
        [
            {
                "type": "shotstack.timeline",
                "provider": "shotstack",
                "renderUrl": "https://render.example/video.mp4",
                "extra": "value",
            },
            {
                # No explicit type/provider/url to exercise defaults
                "assetUrl": "https://assets.example/clip.mp4",
            },
        ],
    )

    assert len(dummy.posts) == 2
    first, second = dummy.posts

    assert first["url"] == "https://api.example/v1/runs/run-abc/artifacts"
    assert first["headers"]["x-api-key"] == "secret-key"
    assert first["json"]["type"] == "shotstack.timeline"
    assert first["json"]["provider"] == "shotstack"
    assert first["json"]["url"] == "https://render.example/video.mp4"
    # metadata should carry through original keys
    assert first["json"]["metadata"]["extra"] == "value"

    assert second["json"]["type"] == "orchestrator.event"
    assert second["json"]["provider"] == "orchestrator"
    assert second["json"]["url"] == "https://assets.example/clip.mp4"

