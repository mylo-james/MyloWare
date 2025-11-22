"""Custom middleware for the API service."""
from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable

from fastapi import Request, Response, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from .config import Settings


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Rejects requests missing the expected API key except for exempt paths."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        settings: Settings,
        exempt_paths: Iterable[str] | None = None,
        exempt_prefixes: Iterable[str] | None = None,
    ) -> None:
        super().__init__(app)
        self._settings = settings
        self._exempt_paths = set(exempt_paths or [])
        self._exempt_prefixes = tuple(exempt_prefixes or ())

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if self._is_exempt(request.url.path):
            return await call_next(request)

        api_key = request.headers.get("x-api-key")
        if not api_key or api_key != self._settings.api_key:
            return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": "Invalid API key"})
        return await call_next(request)

    def _is_exempt(self, path: str) -> bool:
        if path in self._exempt_paths:
            return True
        return any(path.startswith(prefix) for prefix in self._exempt_prefixes)
