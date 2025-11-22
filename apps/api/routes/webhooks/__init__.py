"""Webhook routers grouped by provider."""
from __future__ import annotations

from fastapi import APIRouter

from . import kieai, upload_post

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])
router.include_router(kieai.router)
router.include_router(upload_post.router)

__all__ = ["router"]

