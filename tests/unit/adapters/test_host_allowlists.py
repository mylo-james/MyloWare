from __future__ import annotations

import pytest

import pytest

from adapters.ai_providers.kieai.client import KieAIClient
from adapters.ai_providers.shotstack.client import ShotstackClient
from adapters.social.upload_post.client import UploadPostClient
from content.editing.normalization.ffmpeg import FFmpegNormalizer
from adapters.security.host_allowlist import is_allowed_host, ensure_host_allowed


def test_kieai_rejects_disallowed_host() -> None:
    with pytest.raises(ValueError):
        KieAIClient(
            api_key="key",
            base_url="https://evil.example.com/api",
            signing_secret="secret",
        )


def test_kieai_allows_localhost() -> None:
    client = KieAIClient(
        api_key="key",
        base_url="http://localhost:8081",
        signing_secret="secret",
    )
    client.close()


def test_shotstack_rejects_unknown_host() -> None:
    with pytest.raises(ValueError):
        ShotstackClient(api_key="key", base_url="https://shotstack.bad.net")


def test_upload_post_rejects_unknown_host() -> None:
    with pytest.raises(ValueError):
        UploadPostClient(api_key="key", base_url="https://upload.fake", signing_secret="secret")


def test_upload_post_allows_staging_domain() -> None:
    client = UploadPostClient(
        api_key="key",
        base_url="https://api.upload-post.dev",
        signing_secret="secret",
        allow_dev_hosts=False,
    )
    client.close()


def test_ffmpeg_normalizer_validates_source_host(monkeypatch: pytest.MonkeyPatch) -> None:
    normalizer = FFmpegNormalizer(allowed_hosts=["cdn.allowed.com"])
    with pytest.raises(ValueError):
        normalizer._ensure_allowed_source("https://evil.com/video.mp4")
    normalizer._ensure_allowed_source("https://cdn.allowed.com/video.mp4")


def test_is_allowed_host_handles_test_and_local_hosts() -> None:
    # Localhost and *.test domains are always allowed, even with empty allowlists.
    assert is_allowed_host("localhost", allowed_hosts=[])
    assert is_allowed_host("service.test", allowed_hosts=[])
    assert is_allowed_host("api.example", allowed_hosts=["api.example"])
    # Unknown host not in allowlist should be rejected.
    assert is_allowed_host("evil.com", allowed_hosts=["good.com"]) is False


def test_subdomain_must_be_explicitly_allowed() -> None:
    allowed = ["cdn.allowed.com", "assets.allowed.com"]
    assert is_allowed_host("assets.allowed.com", allowed_hosts=allowed) is True
    # Different subdomain should not be implicitly allowed.
    assert is_allowed_host("video.allowed.com", allowed_hosts=allowed) is False


def test_metadata_and_ipv6_hosts_are_blocked_without_allowlist() -> None:
    with pytest.raises(ValueError):
        ensure_host_allowed("169.254.169.254", allowed_hosts=["api.myloware.com"], component="test")
    with pytest.raises(ValueError):
        ensure_host_allowed("::1", allowed_hosts=["api.myloware.com"], component="test", allow_dev_hosts=False)


def test_local_and_test_hosts_blocked_when_dev_hosts_disabled() -> None:
    assert is_allowed_host("localhost", allowed_hosts=["api.myloware.com"], allow_dev_hosts=False) is False
    assert is_allowed_host("service.test", allowed_hosts=["api.myloware.com"], allow_dev_hosts=False) is False
    with pytest.raises(ValueError):
        ensure_host_allowed("localhost", allowed_hosts=["api.myloware.com"], component="test", allow_dev_hosts=False)
