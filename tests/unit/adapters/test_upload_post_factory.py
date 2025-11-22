from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from adapters.social.upload_post.client import UploadPostClient
from adapters.social.upload_post.factory import get_upload_post_client
from adapters.social.upload_post.fake import UploadPostFakeClient


def _settings(**overrides: object) -> SimpleNamespace:
    defaults = {
        "providers_mode": "mock",
        "upload_post_api_key": "upload-key",
        "upload_post_base_url": "https://api.upload-post.com/api",
        "upload_post_signing_secret": "secret",
        "environment": "local",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_upload_post_factory_returns_fake_in_mock_mode(tmp_path: Path) -> None:
    client = get_upload_post_client(_settings())
    assert isinstance(client, UploadPostFakeClient)
    video_file = tmp_path / "run-xyz.mp4"
    video_file.write_bytes(b"fake video bytes")
    response = client.publish(video_path=video_file, caption="hello world")
    assert response["status"] == "ok"
    assert response["canonicalUrl"] == "https://publish.mock/run-xyz/video"


def test_upload_post_factory_returns_real_client_in_live_mode() -> None:
    client = get_upload_post_client(_settings(providers_mode="live", environment="staging"))
    assert isinstance(client, UploadPostClient)
