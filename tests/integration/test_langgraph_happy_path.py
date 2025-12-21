"""Happy-path LangGraph integration (skipped unless Postgres LangGraph env is provided)."""

import os

import pytest
from sqlalchemy.exc import OperationalError
from fastapi.testclient import TestClient

from myloware.api.server import app
from myloware.config import settings
from myloware.storage.database import init_db
from myloware.workflows.langgraph.graph import clear_graph_cache

# Full LangGraph flow on Postgres; mark parity to keep default fast lane small.
pytestmark = pytest.mark.parity


@pytest.mark.integration
def test_langgraph_happy_path_start_only(monkeypatch):
    """Smoke start_run with LangGraph enabled; uses local Postgres if available."""
    pg_url = os.getenv(
        "PG_TEST_URL",
        "postgresql+psycopg2://myloware:myloware@localhost:55432/myloware",
    )
    monkeypatch.setattr(settings, "database_url", pg_url)
    monkeypatch.setattr(settings, "use_langgraph_engine", True)
    try:
        init_db()
    except OperationalError as exc:
        pytest.skip(f"Postgres not available for parity test: {exc}")
    clear_graph_cache()

    client = TestClient(app)
    resp = client.post(
        "/v2/runs/start",
        headers={"X-API-Key": settings.api_key},
        json={"workflow": "aismr", "brief": "Test brief for happy path"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "run_id" in body and "state" in body
    assert isinstance(body.get("state"), dict)
    # First interrupt (ideation approval) may or may not be present depending on graph; allow either.
    assert body.get("interrupt") is None or isinstance(body.get("interrupt"), dict)
