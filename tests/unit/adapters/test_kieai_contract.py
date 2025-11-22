from __future__ import annotations

import json

import httpx

from adapters.ai_providers.kieai.client import KieAIClient


def test_kieai_submit_job_contract(monkeypatch):
    recorded: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        recorded["method"] = request.method
        recorded["url"] = str(request.url)
        recorded["headers"] = request.headers
        recorded["json"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(200, json={"data": {"taskId": "job-123", "metadata": recorded["json"]["metadata"]}})

    transport = httpx.MockTransport(handler)

    client = KieAIClient(
        api_key="kieai-key",
        base_url="https://api.kie.ai/api/v1/veo",
        signing_secret="secret",
    )
    monkeypatch.setattr(client, "_client", httpx.Client(transport=transport), raising=False)

    response = client.submit_job(
        prompt="Generate a video",
        run_id="run-123",
        callback_url="https://api.myloware.dev/v1/webhooks/kieai",
        duration=8,
        aspect_ratio="9:16",
        quality="720p",
        model="veo3",
        metadata={"videoIndex": 2, "subject": "moon"},
    )

    payload = recorded["json"]
    headers = recorded["headers"]
    assert recorded["method"] == "POST"
    assert recorded["url"].endswith("/generate")
    assert headers["authorization"] == "Bearer kieai-key"
    assert payload["callBackUrl"] == "https://api.myloware.dev/v1/webhooks/kieai"
    assert payload["metadata"]["runId"] == "run-123"
    assert payload["metadata"]["videoIndex"] == 2
    assert payload["idempotencyKey"] == "run-123:video:2"
    assert payload["prompt"] == "Generate a video"
    assert response["data"]["metadata"]["videoIndex"] == 2
