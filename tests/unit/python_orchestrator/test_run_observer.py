from __future__ import annotations

from typing import Any, Mapping

import pytest

from apps.orchestrator import run_observer


def test_extract_render_url_prefers_latest_metadata() -> None:
    artifacts = [
        {"type": "render.url", "url": "https://old"},
        {"type": "render.url", "metadata": {"renderUrl": "https://new"}},
    ]

    value = run_observer.extract_render_url_from_artifacts(artifacts)

    assert value == "https://new"


def test_format_status_summary_counts_statuses() -> None:
    videos = [
        {"status": "pending"},
        {"status": "rendered"},
        {"status": "rendered"},
    ]

    summary = run_observer.format_status_summary(videos)

    assert summary == "pending: 1, rendered: 2"


def test_derive_persona_updates_handles_riley_scripts() -> None:
    run_result = {
        "videos": [
            {"index": 0, "prompt": "Scene 1", "duration": 7, "status": "generated"},
            {"index": 1, "header": "Scene 2", "assetUrl": "https://clip"},
        ],
        "videoDuration": 8,
    }

    updates, message = run_observer.derive_persona_updates(
        persona="riley",
        project="test_video_gen",
        run_id="run-123",
        run_result=run_result,
        artifacts=[],
    )

    assert len(updates["scripts"]) == 2
    assert updates["clips"][1]["assetUrl"] == "https://clip"
    assert "scripts" in message


def test_observe_run_progress_handles_missing_run_id() -> None:
    result = run_observer.observe_run_progress(persona="iggy", project="test_video_gen", state={})

    assert "No run ID" in result.message
    assert result.updates == {}


def test_observe_run_progress_handles_snapshot_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_: str) -> Mapping[str, Any]:
        raise RuntimeError("network down")

    result = run_observer.observe_run_progress(
        persona="alex",
        project="test_video_gen",
        state={"run_id": "run-err"},
        fetch_snapshot=boom,
    )

    assert "Unable to load run" in result.message
    assert result.flags["persona_contract_waived"] is True


def test_observe_run_progress_returns_updates(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = {
        "result": {
            "videos": [{"index": 0, "status": "rendered", "assetUrl": "https://asset"}],
            "publishUrls": ["https://publish"],
        },
        "artifacts": [{"type": "render.url", "url": "https://render"}],
    }

    result = run_observer.observe_run_progress(
        persona="quinn",
        project="test_video_gen",
        state={"run_id": "run-success"},
        fetch_snapshot=lambda _: snapshot,
    )

    assert result.updates["render_url"] == "https://render"
    assert result.updates["completed"] is True
    assert "publish URLs" in result.message
