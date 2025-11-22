from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from apps.api import auth
from apps.api.config import settings
from apps.api.routes import hitl as hitl_module


def _build_request(path: str, api_key: str | None = None) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [],
        "client": ("203.0.113.1", 8080),
        "query_string": b"",
        "server": ("testserver", 80),
    }
    if api_key is not None:
        scope["headers"] = [(b"x-api-key", api_key.encode())]
    return Request(scope)


@pytest.mark.asyncio
async def test_verify_api_key_logs_failure(caplog: pytest.LogCaptureFixture) -> None:
    request = _build_request("/v1/ping", api_key="wrong-key")
    with caplog.at_level("WARNING", logger="myloware.api.auth"):
        with pytest.raises(HTTPException):
            await auth.verify_api_key(request, settings=settings)
    log = caplog.records[-1]
    assert log.path == "/v1/ping"
    assert log.client_ip == "203.0.113.1"


def test_verify_approval_token_logs_invalid(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING", logger="myloware.api.hitl"):
        assert hitl_module.verify_approval_token("bad-token", run_id="run-sec", gate="ideate") is False
    log = caplog.records[-1]
    assert log.run_id == "run-sec"
    assert log.gate == "ideate"
    assert "reason" in log.__dict__
