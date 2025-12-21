from __future__ import annotations

import pytest

from myloware.storage import object_store


def test_build_and_parse_s3_uri_roundtrip() -> None:
    uri = object_store.build_s3_uri(bucket="bucket", key="/path/to/file.mp4")
    assert uri == "s3://bucket/path/to/file.mp4"

    ref = object_store.parse_s3_uri(uri)
    assert ref.bucket == "bucket"
    assert ref.key == "path/to/file.mp4"


def test_parse_s3_uri_invalid() -> None:
    with pytest.raises(ValueError):
        object_store.parse_s3_uri("https://example.com/x")
    with pytest.raises(ValueError):
        object_store.parse_s3_uri("s3://")
    with pytest.raises(ValueError):
        object_store.parse_s3_uri("s3://bucket")


@pytest.mark.asyncio
async def test_resolve_s3_uri_async_passthrough(monkeypatch) -> None:
    assert await object_store.resolve_s3_uri_async("https://example.com") == "https://example.com"

    class FakeStore:
        async def presign_get_async(self, *, uri: str, expires_seconds: int) -> str:
            return f"https://signed/{uri}/{expires_seconds}"

    monkeypatch.setattr(object_store, "get_s3_store", lambda: FakeStore())

    url = await object_store.resolve_s3_uri_async("s3://bucket/key")
    assert url.startswith("https://signed/s3://bucket/key/")


@pytest.mark.asyncio
async def test_s3_store_upload_and_presign(monkeypatch, tmp_path) -> None:
    calls: dict[str, object] = {}

    class FakeClient:
        def upload_file(self, path, bucket, key, ExtraArgs=None):  # type: ignore[no-untyped-def]
            calls["upload"] = (path, bucket, key, ExtraArgs)

        def generate_presigned_url(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return "https://signed.example/url"

    class FakeBoto3:
        def client(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return FakeClient()

    monkeypatch.setattr(object_store, "_require_boto3", lambda: FakeBoto3())
    monkeypatch.setattr(object_store.settings, "transcode_s3_endpoint_url", None)
    monkeypatch.setattr(object_store.settings, "transcode_s3_region", None)

    store = object_store.S3Store()
    path = tmp_path / "clip.mp4"
    path.write_text("data")

    uri = await store.upload_file_async(
        bucket="bucket", key="clip.mp4", path=path, content_type="video/mp4"
    )
    assert uri == "s3://bucket/clip.mp4"
    assert "upload" in calls

    presigned = await store.presign_get_async(uri=uri, expires_seconds=60)
    assert presigned == "https://signed.example/url"
