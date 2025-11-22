from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

from content.editing.normalization.ffmpeg import FFmpegNormalizer


class DummyStream:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def __enter__(self) -> "DummyStream":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def iter_bytes(self):
        yield self._payload

    def raise_for_status(self) -> None:
        return None


class DummyHTTPClient:
    def __init__(self, payload: bytes = b"video-bytes") -> None:
        self.payload = payload
        self.calls: list[tuple[str, str]] = []

    def stream(self, method: str, url: str) -> DummyStream:
        self.calls.append((method, url))
        return DummyStream(self.payload)

    def close(self) -> None:
        return None


def test_normalize_downloads_and_runs_ffmpeg(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    normalizer = FFmpegNormalizer(allowed_hosts=["cdn.example.com"])
    normalizer._http = DummyHTTPClient()  # type: ignore[attr-defined]

    monkeypatch.setattr(
        "content.editing.normalization.ffmpeg.shutil.which",
        lambda cmd: "/usr/bin/ffmpeg" if cmd == "ffmpeg" else None,
    )

    class DummyTmpDir:
        def __enter__(self_self):
            return str(tmp_path)

        def __exit__(self_self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("content.editing.normalization.ffmpeg.tempfile.TemporaryDirectory", lambda: DummyTmpDir())

    recorded_cmd: dict[str, Any] = {}

    def fake_run(cmd: list[str], check: bool) -> None:
        recorded_cmd["cmd"] = cmd
        recorded_cmd["check"] = check
        output_path = cmd[-1]
        Path(output_path).write_bytes(b"normalized-content")

    monkeypatch.setattr("content.editing.normalization.ffmpeg.subprocess.run", fake_run)

    result_path = normalizer.normalize("https://cdn.example.com/video.mp4")

    assert result_path.exists()
    assert result_path.read_bytes() == b"normalized-content"
    assert recorded_cmd["check"] is True
    assert recorded_cmd["cmd"][0] == "ffmpeg"


def test_normalize_requires_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    normalizer = FFmpegNormalizer(allowed_hosts=["cdn.example.com"])
    monkeypatch.setattr("content.editing.normalization.ffmpeg.shutil.which", lambda _: None)

    with pytest.raises(RuntimeError):
        normalizer.normalize("https://cdn.example.com/video.mp4")


def test_normalize_rejects_disallowed_host(monkeypatch: pytest.MonkeyPatch) -> None:
    normalizer = FFmpegNormalizer(allowed_hosts=["cdn.example.com"])
    normalizer._http = DummyHTTPClient()  # type: ignore[attr-defined]
    monkeypatch.setattr(
        "content.editing.normalization.ffmpeg.shutil.which",
        lambda cmd: "/usr/bin/ffmpeg" if cmd == "ffmpeg" else None,
    )

    with pytest.raises(Exception):
        normalizer.normalize("https://evil.example.com/video.mp4")
