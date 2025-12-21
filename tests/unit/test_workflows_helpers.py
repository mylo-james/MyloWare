from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

import asyncio
import pytest

from myloware.config import settings
from myloware.workflows import helpers


@dataclass
class FakeRun:
    id: object
    telegram_chat_id: str | None = None
    metadata: dict[str, object] | None = None


def test_extract_chat_id_prefers_explicit_field() -> None:
    run = FakeRun(id=uuid4(), telegram_chat_id="123")
    assert helpers.extract_chat_id(run) == "123"


def test_extract_chat_id_falls_back_to_metadata() -> None:
    run = FakeRun(id=uuid4(), telegram_chat_id=None, metadata={"telegram_chat_id": "456"})
    assert helpers.extract_chat_id(run) == "456"


def test_extract_chat_id_returns_none_when_missing() -> None:
    run = FakeRun(id=uuid4(), telegram_chat_id=None, metadata={})
    assert helpers.extract_chat_id(run) is None


@dataclass
class FakeArtifact:
    uri: str | None
    artifact_metadata: dict[str, object]


def test_check_video_cache_noops_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "use_video_cache", False)

    class Repo:
        def find_cached_videos(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
            raise AssertionError("should not be called when caching disabled")

    urls, missing = helpers.check_video_cache(Repo(), "topic", signs=["a"], required_count=2)
    assert urls == []
    assert missing == ["a"]


def test_check_video_cache_repeats_urls_and_reports_missing_signs(monkeypatch) -> None:
    monkeypatch.setattr(settings, "use_video_cache", True)

    class Repo:
        def find_cached_videos(self, topic, signs, limit):  # type: ignore[no-untyped-def]
            assert topic == "topic"
            assert signs == ["aries", "taurus"]
            assert limit == 4
            return [
                FakeArtifact(uri="https://cdn/cached.mp4", artifact_metadata={"sign": "aries"}),
            ]

    urls, missing = helpers.check_video_cache(
        Repo(), "topic", signs=["aries", "taurus"], required_count=4
    )

    assert urls == [
        "https://cdn/cached.mp4",
        "https://cdn/cached.mp4",
        "https://cdn/cached.mp4",
        "https://cdn/cached.mp4",
    ]
    assert missing == ["taurus"]


def test_fire_and_forget_runs_coroutine_without_event_loop() -> None:
    done = {"ok": False}

    async def coro() -> None:
        done["ok"] = True

    helpers.fire_and_forget(coro())
    assert done["ok"] is True


@pytest.mark.asyncio
async def test_fire_and_forget_schedules_task_on_running_loop() -> None:
    done = {"ok": False}

    async def coro() -> None:
        done["ok"] = True

    helpers.fire_and_forget(coro())
    await asyncio.sleep(0)
    assert done["ok"] is True


def test_notify_telegram_noops_when_notifier_or_chat_id_missing() -> None:
    run = FakeRun(id=uuid4(), telegram_chat_id=None, metadata={})
    helpers.notify_telegram(run, None, "started")
    helpers.notify_telegram(run, notifier=object(), event="started")  # type: ignore[arg-type]


def test_notify_telegram_dispatches_event(monkeypatch) -> None:
    calls: list[str] = []

    class FakeNotifier:
        async def notify_run_started(self, chat_id: str, run_id: str) -> None:
            calls.append(f"started:{chat_id}:{run_id}")

        async def send_message(self, chat_id: str, message: str) -> None:
            calls.append(f"status:{chat_id}:{message}")

    captured: list[object] = []

    def fake_fire_and_forget(coro) -> None:  # type: ignore[no-untyped-def]
        captured.append(coro)

    monkeypatch.setattr(helpers, "fire_and_forget", fake_fire_and_forget)

    run = FakeRun(id=uuid4(), telegram_chat_id="123")
    helpers.notify_telegram(run, FakeNotifier(), "started")
    helpers.notify_telegram(run, FakeNotifier(), "status_update", message="hi")

    assert len(captured) == 2

    # Execute coroutines to verify side-effects
    import asyncio

    asyncio.run(captured[0])
    asyncio.run(captured[1])

    assert calls[0].startswith("started:123:")
    assert calls[1] == "status:123:hi"


def test_notify_telegram_dispatches_hitl_completed_and_failed(monkeypatch) -> None:
    calls: list[str] = []

    class FakeNotifier:
        async def notify_hitl_required(
            self, chat_id: str, run_id: str, gate: str, content: str
        ) -> None:
            calls.append(f"hitl:{chat_id}:{run_id}:{gate}:{content}")

        async def notify_run_completed(
            self, chat_id: str, run_id: str, artifacts: dict[str, object]
        ) -> None:
            calls.append(f"completed:{chat_id}:{run_id}:{sorted(artifacts.keys())}")

        async def notify_run_failed(
            self, chat_id: str, run_id: str, error: str, step: str | None
        ) -> None:
            calls.append(f"failed:{chat_id}:{run_id}:{error}:{step}")

    captured: list[object] = []

    def fake_fire_and_forget(coro) -> None:  # type: ignore[no-untyped-def]
        captured.append(coro)

    monkeypatch.setattr(helpers, "fire_and_forget", fake_fire_and_forget)

    run = FakeRun(id=uuid4(), telegram_chat_id="123")
    notifier = FakeNotifier()
    helpers.notify_telegram(run, notifier, "hitl_required", gate="publish", content="pls review")
    helpers.notify_telegram(run, notifier, "completed", artifacts={"a": 1})
    helpers.notify_telegram(run, notifier, "failed", error="boom", step="ideation")

    assert len(captured) == 3
    asyncio.run(captured[0])
    asyncio.run(captured[1])
    asyncio.run(captured[2])

    assert calls[0].startswith("hitl:123:")
    assert calls[1].startswith("completed:123:")
    assert calls[2].startswith("failed:123:")


def test_extract_trace_id_returns_none_when_missing() -> None:
    assert helpers.extract_trace_id(object()) is None


def test_check_video_cache_with_no_signs_reports_no_missing(monkeypatch) -> None:
    monkeypatch.setattr(settings, "use_video_cache", True)

    class Repo:
        def find_cached_videos(self, topic, signs, limit):  # type: ignore[no-untyped-def]
            assert topic == "topic"
            assert signs is None
            assert limit == 1
            return [FakeArtifact(uri="https://cdn/cached.mp4", artifact_metadata={})]

    urls, missing = helpers.check_video_cache(Repo(), "topic", signs=None, required_count=1)
    assert urls == ["https://cdn/cached.mp4"]
    assert missing == []
