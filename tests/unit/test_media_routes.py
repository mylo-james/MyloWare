from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi import Request

from myloware.api.routes import media as media_routes


def _fake_request(path: str) -> Request:
    return Request({"type": "http", "method": "HEAD", "path": path, "headers": []})


def test_get_video_url_uses_remotion_service_url(monkeypatch) -> None:
    monkeypatch.setattr(media_routes.settings, "remotion_service_url", "http://remotion")
    assert media_routes._get_video_url("abc") == "http://remotion/output/abc.mp4"


@pytest.mark.asyncio
async def test_head_video_supports_head(monkeypatch) -> None:
    class FakeResponse:
        status_code = 200
        headers = {"content-length": "123"}

        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def head(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            return FakeResponse()

    monkeypatch.setattr(media_routes.httpx, "AsyncClient", lambda *a, **kw: FakeClient())
    resp = await media_routes.head_video("abc", request=_fake_request("/v1/media/video/abc"))
    assert resp.headers["Content-Length"] == "123"


@pytest.mark.asyncio
async def test_head_video_falls_back_when_head_not_allowed(monkeypatch) -> None:
    class Head405:
        status_code = 405
        headers: dict[str, str] = {}

        def raise_for_status(self) -> None:
            return None

    class GetOK:
        status_code = 200
        headers: dict[str, str] = {}
        content = b"abc"

        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def head(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            return Head405()

        async def get(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            return GetOK()

    monkeypatch.setattr(media_routes.httpx, "AsyncClient", lambda *a, **kw: FakeClient())
    resp = await media_routes.head_video("abc", request=_fake_request("/v1/media/video/abc"))
    assert resp.headers["Content-Length"] == str(len(b"abc"))


@pytest.mark.asyncio
async def test_head_video_maps_http_status_error(monkeypatch) -> None:
    req = httpx.Request("HEAD", "http://x")
    res = httpx.Response(404, request=req)
    err = httpx.HTTPStatusError("nope", request=req, response=res)

    class FakeClient:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def head(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            raise err

    monkeypatch.setattr(media_routes.httpx, "AsyncClient", lambda *a, **kw: FakeClient())
    with pytest.raises(Exception) as excinfo:
        await media_routes.head_video("abc", request=_fake_request("/v1/media/video/abc"))
    assert "Video not found" in str(excinfo.value)


@pytest.mark.asyncio
async def test_head_video_maps_unknown_errors_to_500(monkeypatch) -> None:
    class FakeClient:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

        async def head(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            raise RuntimeError("boom")

    monkeypatch.setattr(media_routes.httpx, "AsyncClient", lambda *a, **kw: FakeClient())
    with pytest.raises(Exception) as excinfo:
        await media_routes.head_video("abc", request=_fake_request("/v1/media/video/abc"))
    assert "boom" in str(excinfo.value)


@pytest.mark.asyncio
async def test_get_video_streams_and_propagates_headers(monkeypatch, async_client) -> None:
    payload = [b"a", b"b"]

    class Upstream:
        status_code = 200
        headers = {"content-length": "2", "accept-ranges": "bytes"}

        def raise_for_status(self) -> None:
            return None

        async def aiter_bytes(self):  # type: ignore[no-untyped-def]
            for p in payload:
                yield p

    class StreamCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return Upstream()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            self.closed = False

        def stream(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            return StreamCM()

        async def aclose(self) -> None:
            self.closed = True

    monkeypatch.setattr(media_routes.httpx, "AsyncClient", FakeClient)
    r = await async_client.get("/v1/media/video/abc")
    assert r.status_code == 200
    assert r.headers["Content-Disposition"].endswith('filename="abc.mp4"')
    assert r.headers["Accept-Ranges"] == "bytes"
    assert r.content == b"".join(payload)


@pytest.mark.asyncio
async def test_get_video_maps_http_status_error(monkeypatch, async_client) -> None:
    req = httpx.Request("GET", "http://x")
    res = httpx.Response(404, request=req)
    err = httpx.HTTPStatusError("nope", request=req, response=res)

    class Upstream:
        status_code = 404
        headers: dict[str, str] = {}

        def raise_for_status(self) -> None:
            raise err

        async def aiter_bytes(self):  # type: ignore[no-untyped-def]
            yield b""

    class StreamCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return Upstream()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return None

        def stream(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            return StreamCM()

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(media_routes.httpx, "AsyncClient", FakeClient)
    r = await async_client.get("/v1/media/video/abc")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_video_maps_unknown_errors_to_500(monkeypatch, async_client) -> None:
    class Upstream:
        status_code = 200
        headers: dict[str, str] = {}

        def raise_for_status(self) -> None:
            raise RuntimeError("boom")

        async def aiter_bytes(self):  # type: ignore[no-untyped-def]
            yield b""

    class StreamCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return Upstream()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            self.closed = False

        def stream(self, *_a, **_kw):  # type: ignore[no-untyped-def]
            return StreamCM()

        async def aclose(self) -> None:
            self.closed = True

    monkeypatch.setattr(media_routes.httpx, "AsyncClient", FakeClient)
    r = await async_client.get("/v1/media/video/abc")
    assert r.status_code == 500


@pytest.mark.asyncio
async def test_transcoded_video_head_and_get(monkeypatch, async_client, tmp_path: Path) -> None:
    monkeypatch.setattr(media_routes, "TRANSCODED_DIR", str(tmp_path))
    f = tmp_path / "x.mp4"
    f.write_bytes(b"data")

    r = await async_client.head("/v1/media/transcoded/x.mp4")
    assert r.status_code == 200
    assert r.headers["Content-Length"] == str(len(b"data"))

    r = await async_client.get("/v1/media/transcoded/x.mp4")
    assert r.status_code == 200
    assert r.content == b"data"

    r = await async_client.get("/v1/media/transcoded/missing.mp4")
    assert r.status_code == 404

    r = await async_client.head("/v1/media/transcoded/missing.mp4")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_media_rejects_invalid_ids(monkeypatch, async_client, tmp_path: Path) -> None:
    monkeypatch.setattr(media_routes, "TRANSCODED_DIR", str(tmp_path))

    r = await async_client.get("/v1/media/video/..")
    assert r.status_code in {400, 404}

    r = await async_client.head("/v1/media/transcoded/..")
    assert r.status_code in {400, 404}

    r = await async_client.get("/v1/media/transcoded/../x.mp4")
    assert r.status_code in {400, 404}

    r = await async_client.get("/v1/media/sora/not_video.mp4")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_media_requires_access_token_when_configured(
    monkeypatch, async_client, tmp_path: Path
) -> None:
    monkeypatch.setattr(media_routes, "TRANSCODED_DIR", str(tmp_path))
    monkeypatch.setattr(media_routes.settings, "media_access_token", "token123")

    f = tmp_path / "x.mp4"
    f.write_bytes(b"data")

    r = await async_client.get("/v1/media/transcoded/x.mp4")
    assert r.status_code == 401

    r = await async_client.get(
        "/v1/media/transcoded/x.mp4",
        headers={"Authorization": "Bearer token123"},
    )
    assert r.status_code == 200
