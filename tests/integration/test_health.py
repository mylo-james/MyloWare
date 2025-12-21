import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2] / "src"))

import pytest
from fastapi.testclient import TestClient

from myloware.api.server import app


@pytest.mark.integration
def test_health_deep_contains_keys():
    client = TestClient(app)
    resp = client.get("/health", params={"deep": "true"})
    assert resp.status_code == 200
    data = resp.json()
    assert "knowledge_base_healthy" in data
    assert "shields_available" in data
    assert "llama_stack_reachable" in data
