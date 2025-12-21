from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from myloware.config import settings
from myloware.storage.models import ArtifactType
from myloware.workflows.langgraph.utils import (
    normalize_transcoded_url,
    select_latest_video_clip_urls,
    sorted_video_clip_artifacts,
    sorted_video_clip_urls,
)


@dataclass
class FakeArtifact:
    artifact_type: str
    uri: str | None
    artifact_metadata: dict[str, object] | None
    created_at: datetime
    content: str | None = None


def test_sorted_video_clip_artifacts_filters_and_sorts() -> None:
    now = datetime.now(timezone.utc)

    artifacts = [
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/clip2.mp4",
            artifact_metadata={"video_index": 2},
            created_at=now,
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/clip1.mp4",
            artifact_metadata={"videoIndex": 1},
            created_at=now + timedelta(seconds=1),
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri=None,
            artifact_metadata={"video_index": 0},
            created_at=now,
        ),
        FakeArtifact(
            artifact_type=ArtifactType.IDEAS.value,
            uri="https://example.com/not-a-clip.txt",
            artifact_metadata={"video_index": 0},
            created_at=now,
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/clip3.mp4",
            artifact_metadata=None,
            created_at=now - timedelta(seconds=10),
        ),
    ]

    sorted_artifacts = sorted_video_clip_artifacts(artifacts)
    assert [a.uri for a in sorted_artifacts] == [
        "https://example.com/clip1.mp4",
        "https://example.com/clip2.mp4",
        "https://example.com/clip3.mp4",
    ]


def test_sorted_video_clip_urls_returns_uris_only() -> None:
    now = datetime.now(timezone.utc)
    artifacts = [
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/clip-a.mp4",
            artifact_metadata={"idx": 0},
            created_at=now,
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/clip-b.mp4",
            artifact_metadata={"index": 1},
            created_at=now,
        ),
    ]

    assert sorted_video_clip_urls(artifacts) == [
        "https://example.com/clip-a.mp4",
        "https://example.com/clip-b.mp4",
    ]


def test_sorted_video_clip_artifacts_falls_back_on_non_int_index() -> None:
    now = datetime.now(timezone.utc)
    artifacts = [
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/bad.mp4",
            artifact_metadata={"video_index": "not-an-int"},
            created_at=now,
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/good.mp4",
            artifact_metadata={"video_index": 0},
            created_at=now,
        ),
    ]

    assert [a.uri for a in sorted_video_clip_artifacts(artifacts)] == [
        "https://example.com/good.mp4",
        "https://example.com/bad.mp4",
    ]


def test_select_latest_video_clip_urls_scopes_to_latest_manifest() -> None:
    now = datetime.now(timezone.utc)
    artifacts = [
        FakeArtifact(
            artifact_type=ArtifactType.CLIP_MANIFEST.value,
            uri=None,
            artifact_metadata={"task_count": 1},
            created_at=now - timedelta(minutes=5),
            content='{"old-task": {}}',
        ),
        FakeArtifact(
            artifact_type=ArtifactType.CLIP_MANIFEST.value,
            uri=None,
            artifact_metadata={"task_count": 2},
            created_at=now,
            content='{"new-a": {}, "new-b": {}}',
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/old.mp4",
            artifact_metadata={"task_id": "old-task", "video_index": 0},
            created_at=now - timedelta(minutes=4),
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/new-b.mp4",
            artifact_metadata={"task_id": "new-b", "video_index": 1},
            created_at=now,
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/new-a.mp4",
            artifact_metadata={"task_id": "new-a", "video_index": 0},
            created_at=now,
        ),
    ]
    assert select_latest_video_clip_urls(artifacts) == [
        "https://example.com/new-a.mp4",
        "https://example.com/new-b.mp4",
    ]


def test_select_latest_video_clip_urls_falls_back_without_manifest() -> None:
    now = datetime.now(timezone.utc)
    artifacts = [
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/clip-a.mp4",
            artifact_metadata={"video_index": 0},
            created_at=now,
        ),
        FakeArtifact(
            artifact_type=ArtifactType.VIDEO_CLIP.value,
            uri="https://example.com/clip-b.mp4",
            artifact_metadata={"video_index": 1},
            created_at=now,
        ),
    ]
    assert select_latest_video_clip_urls(artifacts) == [
        "https://example.com/clip-a.mp4",
        "https://example.com/clip-b.mp4",
    ]


def test_normalize_transcoded_url_rebases(monkeypatch) -> None:
    monkeypatch.setattr(settings, "webhook_base_url", "https://new-base.example")
    assert (
        normalize_transcoded_url("https://old-base.example/v1/media/transcoded/clip-1.mp4")
        == "https://new-base.example/v1/media/transcoded/clip-1.mp4"
    )
    assert (
        normalize_transcoded_url("/v1/media/transcoded/clip-2.mp4")
        == "https://new-base.example/v1/media/transcoded/clip-2.mp4"
    )
    assert (
        normalize_transcoded_url("https://cdn.example.com/other.mp4")
        == "https://cdn.example.com/other.mp4"
    )


def test_normalize_transcoded_url_rebases_s3_transcode_uris(monkeypatch) -> None:
    monkeypatch.setattr(settings, "webhook_base_url", "https://new-base.example")
    monkeypatch.setattr(settings, "transcode_s3_bucket", "bucket-a")
    monkeypatch.setattr(settings, "transcode_s3_prefix", "myloware/transcoded")

    assert (
        normalize_transcoded_url(
            "s3://bucket-a/myloware/transcoded/sora_00000000-0000-0000-0000-000000000000_0.mp4"
        )
        == "https://new-base.example/v1/media/transcoded/sora_00000000-0000-0000-0000-000000000000_0.mp4"
    )

    # Bucket mismatch -> leave untouched (caller may presign explicitly).
    assert (
        normalize_transcoded_url(
            "s3://bucket-b/myloware/transcoded/sora_00000000-0000-0000-0000-000000000000_1.mp4"
        )
        == "s3://bucket-b/myloware/transcoded/sora_00000000-0000-0000-0000-000000000000_1.mp4"
    )
