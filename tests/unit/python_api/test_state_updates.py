from __future__ import annotations

from typing import Any

import pytest

from apps.api.services.test_video_gen import state_updates


class FakeDB:
    def __init__(self, record: dict[str, Any] | None = None) -> None:
        self.record = record or {}
        self.updated: dict[str, Any] | None = None

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        return self.record

    def update_run(self, *, run_id: str, status: str, result: dict[str, Any]) -> None:
        self.updated = {"run_id": run_id, "status": status, "result": result}
        self.record = {**(self.record or {}), "result": result, "status": status}


class FakeService:
    def __init__(self, record: dict[str, Any]) -> None:
        self._db = FakeDB(record)


def test_mark_video_generated_updates_existing_entry_and_counts() -> None:
    record = {
        "payload": {
            "project_spec": {
                "specs": {
                    "videoCount": 2,
                    "videoDuration": 7.5,
                }
            }
        },
        "result": {
            "videos": [
                {"index": 0, "duration": 12.0, "subject": "Old", "header": "Old"},
            ]
        },
    }
    service = FakeService(record)

    state_updates.mark_video_generated_impl(
        service,
        run_id="run-1",
        video={"index": 0, "subject": "New Subject", "header": "New Header"},
        asset_url="https://asset.local/video.mp4",
        prompt="Shot from CLI",
    )

    assert service._db.updated is not None
    result = service._db.updated["result"]
    assert result["videos"][0]["assetUrl"] == "https://asset.local/video.mp4"
    assert result["videos"][0]["prompt"] == "Shot from CLI"
    assert result["videos"][0]["duration"] == 12.0  # preserves stored duration
    assert result["totalVideos"] == 2
    assert service._db.updated["status"] == "generating"


def test_mark_video_generated_raises_when_asset_missing() -> None:
    service = FakeService({})
    with pytest.raises(ValueError):
        state_updates.mark_video_generated_impl(
            service,
            run_id="run-1",
            video={"index": 1},
            asset_url=None,
            prompt="Missing asset",
        )


def test_hydrate_video_spec_falls_back_to_template() -> None:
    record = {
        "payload": {
            "project_spec": {
                "specs": {
                    "videos": [
                        {"subject": "Template Subject", "header": "Template Header"},
                    ]
                }
            }
        },
        "result": {"videos": []},
    }
    service = FakeService(record)

    enriched = state_updates.hydrate_video_spec_impl(
        service,
        run_id="run-1",
        video={"index": 0},
    )

    assert enriched["subject"] == "Template Subject"
    assert enriched["header"] == "Template Header"


def test_mark_video_generated_sets_total_when_expected_missing() -> None:
    record = {
        "payload": {"project_spec": {"specs": {}}},
        "result": {"videos": []},
    }
    service = FakeService(record)

    state_updates.mark_video_generated_impl(
        service,
        run_id="run-2",
        video={"index": 1, "subject": "Scene", "header": "Title"},
        asset_url="https://asset/2.mp4",
        prompt="Prompt",
    )

    assert service._db.updated is not None
    assert service._db.updated["result"]["totalVideos"] == 1
