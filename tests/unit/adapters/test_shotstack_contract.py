from __future__ import annotations

import json
import hashlib

import httpx

from adapters.ai_providers.shotstack.client import ShotstackClient


def test_shotstack_render_contract(monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"response": {"id": "render-321", "status": "queued"}})
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "response": {"status": "done", "url": "https://shotstack.example/render.mp4", "id": "render-321"},
                },
            )
        raise AssertionError(f"Unexpected method {request.method}")

    transport = httpx.MockTransport(handler)
    client = ShotstackClient(
        api_key="shotstack-key",
        base_url="https://api.shotstack.io/v1",
        cache=None,
        poll_interval=0.0,
    )
    monkeypatch.setattr(client, "_client", httpx.Client(transport=transport), raising=False)
    monkeypatch.setattr("adapters.ai_providers.shotstack.client.run_with_retry", lambda fn: fn())

    timeline = {"timeline": {"tracks": [{"clips": ["one"]}]}}
    result = client.render(timeline)

    assert result["url"] == "https://shotstack.example/render.mp4"
    assert len(requests) >= 2
    post_request = next(req for req in requests if req.method == "POST")
    payload = json.loads(post_request.content.decode("utf-8"))
    assert payload == timeline
    headers = post_request.headers
    assert headers["x-api-key"] == "shotstack-key"
    expected_key = hashlib.sha256(json.dumps(timeline, sort_keys=True).encode("utf-8")).hexdigest()
    assert headers["Idempotency-Key"] == expected_key

    get_request = next(req for req in requests if req.method == "GET")
    assert str(get_request.url).endswith("/render/render-321")
    assert get_request.headers["x-api-key"] == "shotstack-key"
