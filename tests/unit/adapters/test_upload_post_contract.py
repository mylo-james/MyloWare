from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from email.parser import BytesParser
from email.policy import default
from pathlib import Path

import httpx

from adapters.social.upload_post.client import UploadPostClient


def _parse_multipart(content_type: str, body: bytes) -> dict[str, list[bytes]]:
    message = BytesParser(policy=default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
    )
    if not message.is_multipart():
        raise AssertionError("Expected multipart body")
    parts: dict[str, list[bytes]] = defaultdict(list)
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        parts[name].append(part.get_payload(decode=True) or b"")
    return parts


def test_upload_post_publish_contract(monkeypatch, tmp_path: Path) -> None:
    recorded: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        recorded["method"] = request.method
        recorded["url"] = str(request.url)
        recorded["headers"] = request.headers
        recorded["body"] = request.content
        return httpx.Response(200, json={"canonicalUrl": "https://tiktok.example/video", "id": "publish-1"})

    transport = httpx.MockTransport(handler)
    client = UploadPostClient(
        api_key="upload-key",
        base_url="https://api.upload-post.com/api",
        signing_secret="secret",
        cache=None,
    )
    monkeypatch.setattr(client, "_client", httpx.Client(transport=transport), raising=False)

    video_path = tmp_path / "clip.mp4"
    video_bytes = b"0123456789"
    video_path.write_bytes(video_bytes)

    response = client.publish(
        video_path=video_path,
        caption="Launch day",
        account_id="acct-42",
        title="Launch",
        platforms=["tiktok", "instagram"],
    )

    assert response["canonicalUrl"] == "https://tiktok.example/video"
    assert recorded["method"] == "POST"
    assert recorded["url"].endswith("/upload")

    headers: httpx.Headers = recorded["headers"]  # type: ignore[assignment]
    assert headers["Authorization"] == "Apikey upload-key"
    assert headers["x-social-account-id"] == "acct-42"

    video_checksum = hashlib.sha256(video_bytes).hexdigest()
    cache_key = {
        "video_checksum": video_checksum,
        "caption": "Launch day",
        "account_id": "acct-42",
        "title": "Launch",
        "platforms": ["tiktok", "instagram"],
    }
    expected_idempotency = hashlib.sha256(json.dumps(cache_key, sort_keys=True).encode("utf-8")).hexdigest()
    assert headers["Idempotency-Key"] == expected_idempotency

    body: bytes = recorded["body"]  # type: ignore[assignment]
    parts = _parse_multipart(headers["Content-Type"], body)
    assert parts["caption"] == [b"Launch day"]
    assert parts["title"] == [b"Launch"]
    assert parts["user"] == [b"acct-42"]
    assert parts["platform[]"] == [b"tiktok", b"instagram"]
    assert parts["video"][0] == video_bytes
