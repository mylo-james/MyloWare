"""Unit tests for public demo endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.anyio
async def test_public_demo_start_disabled(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "public_demo_enabled", False)
    resp = await async_client.post("/v1/public/demo/start", json={"brief": "Hello"})
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_public_demo_start_and_status(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "public_demo_enabled", True)
    monkeypatch.setattr(settings, "public_demo_allowed_workflows", ["motivational"])

    resp = await async_client.post(
        "/v1/public/demo/start",
        json={"brief": "Create a short motivational video about resilience."},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "pending"
    assert payload.get("public_token")

    token = payload["public_token"]
    status = await async_client.get(f"/v1/public/demo/runs/{token}")
    assert status.status_code == 200
    data = status.json()
    assert data["status"] in {"pending", "running", "awaiting_ideation_approval"}
    assert data.get("brief")
    assert "activity" in data
    assert isinstance(data["activity"], list)
    assert data["activity"]
    assert data["activity"][-1]["type"] == "run"


@pytest.mark.anyio
async def test_public_demo_gate_requires_awaiting_status(async_client, monkeypatch) -> None:
    from myloware.config.settings import settings

    monkeypatch.setattr(settings, "public_demo_enabled", True)
    monkeypatch.setattr(settings, "public_demo_allowed_workflows", ["motivational"])

    resp = await async_client.post(
        "/v1/public/demo/start",
        json={"brief": "Create a short motivational video about resilience."},
    )
    assert resp.status_code == 200
    token = resp.json()["public_token"]

    approve = await async_client.post(
        f"/v1/public/demo/runs/{token}/approve",
        json={"comment": "approve"},
    )
    assert approve.status_code == 400

    reject = await async_client.post(
        f"/v1/public/demo/runs/{token}/reject",
        json={"comment": "reject"},
    )
    assert reject.status_code == 400
