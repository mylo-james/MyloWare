"""Simple API key authentication dependency."""
from __future__ import annotations

from typing import Annotated

import logging

from fastapi import Depends, HTTPException, Request, status

from .config import Settings, get_settings

logger = logging.getLogger("myloware.api.auth")

async def verify_api_key(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """Raise 401 if the caller omits or mis-states the API key."""

    api_key = request.headers.get("x-api-key")
    if not api_key or api_key != settings.api_key:
        client_ip = request.client.host if request.client else "unknown"
        logger.warning(
            "API key authentication failed",
            extra={"path": request.url.path, "client_ip": client_ip},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
