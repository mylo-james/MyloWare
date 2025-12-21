import pytest


@pytest.mark.integration
@pytest.mark.anyio
async def test_runs_start_returns_pending(async_client, api_headers):
    """Start run returns pending status with isolated DB and lifespan enabled."""
    payload = {"workflow": "aismr", "brief": "Test brief"}

    resp = await async_client.post("/v1/runs/start", json=payload, headers=api_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert data["run_id"]
