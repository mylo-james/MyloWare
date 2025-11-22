from __future__ import annotations

from typing import Any, Dict

from fastapi.testclient import TestClient

from apps.mcp_adapter.main import app


def test_start_run_method_no_longer_exposed() -> None:
    client = TestClient(app)
    payload: Dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "start_run",
        "params": {"project": "test_video_gen", "input": {"prompt": "demo"}},
    }
    resp = client.post("/mcp", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == "1"
    # Method should be treated as unknown
    assert body["error"]["code"] == -32601
    assert "Method not found" in body["error"]["message"]

