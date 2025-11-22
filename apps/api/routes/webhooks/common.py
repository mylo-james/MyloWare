"""Shared helpers for webhook routes (security and validation)."""
from __future__ import annotations

import logging
import time
from typing import Mapping, Tuple

from fastapi import HTTPException, Request, status

from ...storage import Database

logger = logging.getLogger("myloware.api.webhooks")

MAX_WEBHOOK_BODY_BYTES = 1_000_000  # 1 MB
ALLOWED_CONTENT_TYPES = {"application/json", "application/octet-stream"}


async def validate_and_extract_webhook(
    request: Request,
    *,
    db: Database,
    provider: str,
    replay_window_seconds: int = 300,
) -> tuple[Mapping[str, str], bytes]:
    """Apply basic webhook safety checks and return normalized headers + body.

    - Enforces a max body size and content-type allowlist.
    - Generates synthetic request ID if missing (we can't control third-party webhook formats).
    - Signature verification happens in the service layer.
    - Timestamp validation is advisory only (logged but not enforced).
    """
    body = await request.body()
    if len(body) > MAX_WEBHOOK_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="webhook payload too large",
        )

    content_type_header = request.headers.get("content-type", "")
    content_type = content_type_header.split(";", 1)[0].strip().lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"unsupported content-type: {content_type_header}",
        )

    headers = {k.lower(): v for k, v in request.headers.items()}

    # Generate synthetic request ID if missing (third-party providers may not send one)
    request_id = headers.get("x-request-id")
    if not request_id:
        import hashlib
        request_id = f"{provider}-{hashlib.sha256(body).hexdigest()[:16]}"
        headers["x-request-id"] = request_id
        logger.info(
            "Generated synthetic request ID for webhook",
            extra={"provider": provider, "request_id": request_id},
        )

    # Signature is optional at this layer; service layer will verify if present
    signature = (
        headers.get("x-signature")
        or headers.get("x-kie-signature")
        or headers.get("x-webhook-signature")
    )
    if isinstance(signature, str):
        signature = signature.strip()
    if signature:
        headers["x-signature"] = signature

    # Timestamp validation is advisory only (log but don't reject)
    timestamp_raw = headers.get("x-timestamp")
    ts: int | None
    try:
        ts = int(timestamp_raw) if timestamp_raw is not None else None
    except (TypeError, ValueError):
        ts = None

    if ts is not None:
        now = int(time.time())
        if abs(now - ts) > replay_window_seconds:
            logger.warning(
                "Webhook timestamp outside replay window (accepting anyway)",
                extra={"provider": provider, "request_id": request_id, "timestamp": ts, "now": now},
            )

    return headers, body
