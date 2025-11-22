from __future__ import annotations

from types import SimpleNamespace

import pytest

from adapters.ai_providers.kieai.client import KieAIClient
from adapters.ai_providers.kieai.factory import get_kieai_client
from adapters.ai_providers.kieai.fake import KieAIFakeClient


def _settings(**overrides: object) -> SimpleNamespace:
    defaults = {
        "providers_mode": "mock",
        "kieai_api_key": "test-key",
        "kieai_base_url": "https://api.kie.ai/api/v1/veo",
        "kieai_signing_secret": "secret",
        "environment": "local",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_get_kieai_client_returns_fake_in_mock_mode() -> None:
    client = get_kieai_client(_settings(providers_mode="mock"))
    assert isinstance(client, KieAIFakeClient)
    response = client.submit_job(
        prompt="make a short clip",
        run_id="run-123",
        callback_url="https://callback",
        duration=5,
        aspect_ratio="9:16",
        quality="720p",
        model="veo3",
        metadata={"videoIndex": 2},
    )
    assert response["data"]["taskId"] == "run-123-2"


def test_get_kieai_client_returns_real_client_in_live_mode() -> None:
    client = get_kieai_client(_settings(providers_mode="live", environment="staging"))
    assert isinstance(client, KieAIClient)
