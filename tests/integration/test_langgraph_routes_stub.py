"""Lightweight LangGraph route test ensuring engine flag gating works without DB setup."""

import pytest
from fastapi.testclient import TestClient

from myloware.api.server import app
from myloware.config import settings


@pytest.mark.integration
def test_langgraph_routes_disabled_returns_501(monkeypatch):
    # Force feature flag off to avoid DB work; route should 501
    monkeypatch.setattr(settings, "use_langgraph_engine", False)
    client = TestClient(app)

    resp = client.post(
        "/v2/runs/start",
        headers={"X-API-Key": settings.api_key},
        json={"workflow": "aismr", "brief": "Test"},
    )
    assert resp.status_code == 501
    assert "LangGraph engine is not enabled" in resp.text
