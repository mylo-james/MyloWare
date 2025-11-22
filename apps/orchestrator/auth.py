"""API key guard for the orchestrator service."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from .config import Settings, get_settings


async def verify_api_key(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    api_key = request.headers.get("x-api-key")
    if not api_key or api_key != settings.api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
