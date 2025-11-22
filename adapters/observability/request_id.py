"""Request ID helpers shared across services."""
from __future__ import annotations

import contextvars
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

_request_id_ctx_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


def set_request_id(request_id: str) -> None:
    _request_id_ctx_var.set(request_id)


def get_request_id() -> str:
    return _request_id_ctx_var.get()


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Ensures every request/response pair carries a request ID."""

    header_name = "X-Request-ID"

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:  # type: ignore[override]
        request_id = request.headers.get(self.header_name, str(uuid.uuid4()))
        set_request_id(request_id)
        response = await call_next(request)
        response.headers[self.header_name] = request_id
        return response
