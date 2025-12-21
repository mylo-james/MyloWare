from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

import pytest

from myloware.workflows import dlq_replay


def test_extract_sora_video_urls_prefers_top_level_list() -> None:
    payload = {"video_urls": ["a", "b"]}
    assert dlq_replay._extract_sora_video_urls(payload) == ["a", "b"]


def test_extract_sora_video_urls_reads_result_json() -> None:
    payload = {"data": {"resultJson": '{"resultUrls":["u1","u2"]}'}}
    assert dlq_replay._extract_sora_video_urls(payload) == ["u1", "u2"]


def test_extract_sora_video_urls_handles_invalid_result_json() -> None:
    payload = {"data": {"resultJson": "{not json}"}}
    assert dlq_replay._extract_sora_video_urls(payload) == []


def test_extract_sora_video_urls_reads_data_info() -> None:
    payload = {"data": {"info": {"resultUrls": ["u3"]}}}
    assert dlq_replay._extract_sora_video_urls(payload) == ["u3"]


def test_extract_remotion_video_url_prefers_video_url() -> None:
    assert dlq_replay._extract_remotion_video_url({"video_url": "u"}) == "u"


def test_extract_remotion_video_url_falls_back_to_final_video_url() -> None:
    assert dlq_replay._extract_remotion_video_url({"final_video_url": "u"}) == "u"


@dataclass
class DeadLetter:
    id: object
    source: str
    payload: object
    run_id: str


@pytest.mark.asyncio
async def test_replay_dead_letter_sora(monkeypatch) -> None:
    calls: list[tuple[str, bool]] = []

    async def fake_resume_after_videos(run_id: str, *, raise_on_error: bool) -> None:
        calls.append((run_id, raise_on_error))

    monkeypatch.setattr(dlq_replay.resume_ops, "resume_after_videos", fake_resume_after_videos)

    run_id = "00000000-0000-0000-0000-000000000123"
    dead_letter = DeadLetter(
        id=uuid4(), source="sora", payload={"video_urls": ["u1"]}, run_id=run_id
    )
    out = await dlq_replay.replay_dead_letter(dead_letter)

    assert out["status"] == "replayed"
    assert out["source"] == "sora"
    assert out["video_urls"] == ["u1"]
    assert calls == [(run_id, True)]


@pytest.mark.asyncio
async def test_replay_dead_letter_remotion(monkeypatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    async def fake_resume_after_render(
        run_id: str, video_url: str, *, raise_on_error: bool
    ) -> None:
        calls.append((run_id, video_url, raise_on_error))

    monkeypatch.setattr(dlq_replay.resume_ops, "resume_after_render", fake_resume_after_render)

    run_id = "00000000-0000-0000-0000-000000000123"
    dead_letter = DeadLetter(
        id=uuid4(), source="remotion", payload={"final_video_url": "u"}, run_id=run_id
    )
    out = await dlq_replay.replay_dead_letter(dead_letter)

    assert out["status"] == "replayed"
    assert out["source"] == "remotion"
    assert out["video_url"] == "u"
    assert calls == [(run_id, "u", True)]


@pytest.mark.asyncio
async def test_replay_dead_letter_rejects_non_dict_payload() -> None:
    dead_letter = DeadLetter(id=uuid4(), source="sora", payload="not-a-dict", run_id="r")
    with pytest.raises(ValueError, match="payload must be a JSON object"):
        await dlq_replay.replay_dead_letter(dead_letter)


@pytest.mark.asyncio
async def test_replay_dead_letter_rejects_unknown_source() -> None:
    dead_letter = DeadLetter(id=uuid4(), source="unknown", payload={}, run_id="r")
    with pytest.raises(ValueError, match="Unknown source"):
        await dlq_replay.replay_dead_letter(dead_letter)


@pytest.mark.asyncio
async def test_replay_dead_letter_requires_video_urls_for_sora() -> None:
    dead_letter = DeadLetter(id=uuid4(), source="sora", payload={}, run_id="r")
    with pytest.raises(ValueError, match="missing video_urls"):
        await dlq_replay.replay_dead_letter(dead_letter)


@pytest.mark.asyncio
async def test_replay_dead_letter_requires_video_url_for_remotion() -> None:
    dead_letter = DeadLetter(id=uuid4(), source="remotion", payload={}, run_id="r")
    with pytest.raises(ValueError, match="missing video_url"):
        await dlq_replay.replay_dead_letter(dead_letter)
