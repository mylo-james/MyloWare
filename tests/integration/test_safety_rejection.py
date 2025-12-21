import pytest
from fastapi.testclient import TestClient

from myloware.api.server import app
from myloware.config import settings


@pytest.mark.integration
def test_safety_rejects_keyword(tmp_path, monkeypatch: pytest.MonkeyPatch):
    # ensure fake providers to bypass external shield model lookup while keyword filter still blocks
    monkeypatch.setattr(settings, "llama_stack_provider", "fake")
    monkeypatch.setattr(settings, "enable_safety_shields", True)
    monkeypatch.setattr(
        settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 'safety_rejection.db'}"
    )
    headers = {"X-API-Key": settings.api_key}
    payload = {"workflow": "aismr", "brief": "this contains a bomb"}
    with TestClient(app) as client:
        resp = client.post("/v1/runs/start", json=payload, headers=headers)
    assert resp.status_code == 400
    data = resp.json()
    assert data["error"] == "content_blocked"
