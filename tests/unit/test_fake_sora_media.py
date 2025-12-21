from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from myloware.api.routes import media
from myloware.config import settings
from myloware.services.fake_sora import fake_sora_task_id_from_path


def test_media_fake_sora_serves_mp4(monkeypatch, tmp_path: Path) -> None:
    clip = tmp_path / "video1_test.mp4"
    clip.write_bytes(b"fake-mp4-bytes")

    monkeypatch.setattr(settings, "sora_fake_clip_paths", [str(clip)])
    task_id = fake_sora_task_id_from_path(clip, 0)

    app = FastAPI()
    app.include_router(media.router)
    client = TestClient(app)

    head = client.head(f"/v1/media/sora/{task_id}.mp4")
    assert head.status_code == 200
    assert head.headers.get("content-type", "").startswith("video/mp4")
    assert head.headers.get("accept-ranges") == "bytes"

    resp = client.get(f"/v1/media/sora/{task_id}.mp4")
    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("video/mp4")
    assert resp.content == b"fake-mp4-bytes"


def test_media_fake_sora_rejects_invalid_task_id() -> None:
    app = FastAPI()
    app.include_router(media.router)
    client = TestClient(app)

    resp = client.get("/v1/media/sora/not_video.mp4")
    assert resp.status_code == 400
