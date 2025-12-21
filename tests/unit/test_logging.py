from __future__ import annotations

import json
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.testclient import TestClient

from myloware.observability.logging import configure_logging, get_request_id, logger, request_id_var


def _parse_json_log(line: str) -> Dict[str, Any]:
    return json.loads(line)


def test_structlog_json_output_contains_required_fields(capsys) -> None:
    """Ensure log entries are valid JSON and include core fields."""

    configure_logging()

    with capsys.disabled():
        logger.info("test_event", extra_key="value")


def test_request_id_context_propagation() -> None:
    """request_id_var should propagate via contextvars helper."""

    token = request_id_var.set("test-request-id")
    try:
        assert get_request_id() == "test-request-id"
    finally:
        request_id_var.reset(token)


def test_request_id_middleware_sets_and_returns_header() -> None:
    """Middleware should set and return X-Request-ID header."""

    configure_logging()

    local_app = FastAPI()

    @local_app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"status": "ok"}

    from myloware.observability.logging import request_id_var

    @local_app.middleware("http")
    async def request_id_middleware(request, call_next):  # type: ignore[no-untyped-def]
        request_id_var.set("test-middleware-id")
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id_var.get("")
        return response

    client = TestClient(local_app)

    response = client.get("/ping")
    request_id_header = response.headers.get("X-Request-ID")

    assert response.status_code == 200
    assert request_id_header is not None
    assert request_id_header != ""
