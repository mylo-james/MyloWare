from __future__ import annotations

from myloware.config import settings
from myloware.services.remotion_urls import normalize_remotion_output_url


def test_normalize_remotion_output_url_rewrites_configured_host(monkeypatch) -> None:
    monkeypatch.setattr(settings, "webhook_base_url", "https://api.example")
    monkeypatch.setattr(settings, "remotion_service_url", "https://remotion.example")

    assert (
        normalize_remotion_output_url("https://remotion.example/output/abc123.mp4")
        == "https://api.example/v1/media/video/abc123"
    )


def test_normalize_remotion_output_url_leaves_unrelated_hosts(monkeypatch) -> None:
    monkeypatch.setattr(settings, "webhook_base_url", "https://api.example")
    monkeypatch.setattr(settings, "remotion_service_url", "https://remotion.example")

    assert (
        normalize_remotion_output_url("https://cdn.example/output/abc123.mp4")
        == "https://cdn.example/output/abc123.mp4"
    )
