from __future__ import annotations

from types import SimpleNamespace

from adapters.ai_providers.shotstack.client import ShotstackClient
from adapters.ai_providers.shotstack.factory import get_shotstack_client
from adapters.ai_providers.shotstack.fake import ShotstackFakeClient


def _settings(**overrides: object) -> SimpleNamespace:
    defaults = {
        "providers_mode": "mock",
        "shotstack_api_key": "shotstack-key",
        "shotstack_base_url": "https://api.shotstack.io",
        "environment": "local",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_shotstack_factory_returns_fake_in_mock_mode() -> None:
    client = get_shotstack_client(_settings(providers_mode="mock"))
    assert isinstance(client, ShotstackFakeClient)
    timeline = {"meta": {"runId": "run-abc"}}
    response = client.render(timeline)
    assert response["url"].startswith("https://mock.video.myloware/run-abc-final.mp4")
    assert response["status"] == "done"


def test_shotstack_factory_returns_real_client_in_live_mode() -> None:
    client = get_shotstack_client(_settings(providers_mode="live", environment="staging"))
    assert isinstance(client, ShotstackClient)
    # Staging/production environments should use an extended poll timeout so
    # Shotstack has enough time to produce the final S3 URL.
    assert getattr(client, "_poll_timeout", 0) >= 300.0
