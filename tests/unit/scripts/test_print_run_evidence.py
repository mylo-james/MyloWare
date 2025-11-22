from __future__ import annotations

import datetime as _dt
from typing import Any

import pytest

from scripts.dev import print_run_evidence


class FakeDB:
    def __init__(self, *, run: dict[str, Any] | None = None) -> None:
        self._run = run or {
            "run_id": "run-123",
            "project": "test_video_gen",
            "status": "published",
            "payload": {"input": {"prompt": "demo"}},
            "result": {"publishUrls": ["https://example/video.mp4"], "totalVideos": 2},
            "created_at": _dt.datetime(2025, 11, 14, 15, 30, tzinfo=_dt.timezone.utc),
            "updated_at": _dt.datetime(2025, 11, 14, 16, 5, tzinfo=_dt.timezone.utc),
        }
        self.artifacts: list[dict[str, Any]] = [
            {
                "id": "art-1",
                "type": "kieai.job",
                "provider": "kieai",
                "url": None,
                "metadata": {"videoIndex": 0, "subject": "Moon"},
                "created_at": _dt.datetime(2025, 11, 14, 15, 31, tzinfo=_dt.timezone.utc),
                "persona": "riley",
            }
        ]
        self.events: list[dict[str, Any]] = [
            {
                "id": "evt-1",
                "provider": "kieai",
                "idempotency_key": "req-1",
                "signature_status": "verified",
                "received_at": _dt.datetime(2025, 11, 14, 15, 32, tzinfo=_dt.timezone.utc),
                "payload": b"{\"data\": {\"runId\": \"run-123\", \"state\": \"success\"}}",
                "headers": {"x-request-id": "req-1"},
            },
            {
                "id": "evt-2",
                "provider": "upload-post",
                "idempotency_key": "req-2",
                "signature_status": "verified",
                "received_at": _dt.datetime(2025, 11, 14, 15, 33, tzinfo=_dt.timezone.utc),
                "payload": b"{\"data\": {\"runId\": \"other\", \"state\": \"success\"}}",
                "headers": {"x-request-id": "req-2"},
            },
        ]

    def get_run(self, run_id: str) -> dict[str, Any] | None:  # noqa: D401
        if self._run and self._run.get("run_id") == run_id:
            return self._run
        return None

    def list_artifacts(self, run_id: str) -> list[dict[str, Any]]:  # noqa: D401
        return list(self.artifacts)

    def list_webhook_events(self, *, providers: list[str] | None = None, limit: int = 200) -> list[dict[str, Any]]:  # noqa: D401
        assert providers is None or providers
        assert limit > 0
        return list(self.events)


def test_collect_run_evidence_filters_webhooks() -> None:
    db = FakeDB()
    summary = print_run_evidence.collect_run_evidence(
        db,
        "run-123",
        providers=["kieai", "upload-post"],
        max_events=100,
    )

    assert summary["run"]["run_id"] == "run-123"
    assert len(summary["artifacts"]) == 1
    assert summary["artifacts"][0]["type"] == "kieai.job"
    assert summary["artifacts"][0]["persona"] == "riley"

    # Only one webhook matches the target runId
    events = summary["webhookEvents"]
    assert len(events) == 1
    event = events[0]
    assert event["provider"] == "kieai"
    assert "payloadPreview" in event
    assert "run-123" in event["payloadPreview"]
    assert "payload" not in event
    assert event["matchedOn"] == ["payload"]


def test_collect_run_evidence_raises_when_run_missing() -> None:
    db = FakeDB(run=None)
    with pytest.raises(LookupError):
        print_run_evidence.collect_run_evidence(db, "missing-run")
