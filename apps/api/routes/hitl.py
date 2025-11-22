"""HITL (Human-in-the-Loop) approval endpoints."""
from __future__ import annotations

import json
import hmac
import hashlib
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, Mapping

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse

from ..deps import get_database
from ..storage import Database
from ..orchestrator_client import OrchestratorClient
from ..deps import get_orchestrator_client
from ..config import get_settings
from ..rate_limiter import rate_limit_dependency

router = APIRouter(prefix="/v1/hitl", tags=["hitl"])

settings = get_settings()
logger = logging.getLogger("myloware.api.hitl")

# Use HITL_SECRET env when present; otherwise fall back to API key
RAW_HITL_SECRET = settings.hitl_secret or settings.api_key
HITL_SECRET = RAW_HITL_SECRET.encode("utf-8")
HITL_TOKEN_EXPIRY_HOURS = 24


def generate_approval_token(run_id: str, gate: str) -> str:
    """Generate HMAC-SHA256 signed approval token."""
    timestamp = int(time.time())
    message = f"{run_id}:{gate}:{timestamp}"
    signature = hmac.new(HITL_SECRET, message.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{timestamp}:{signature}"


def verify_approval_token(token: str, run_id: str, gate: str) -> bool:
    """Verify HMAC-SHA256 signed approval token."""

    def _log(reason: str) -> None:
        logger.warning(
            "Approval token verification failed",
            extra={"run_id": run_id, "gate": gate, "reason": reason},
        )

    try:
        parts = token.split(":")
        if len(parts) != 2:
            _log("malformed")
            return False
        timestamp_str, signature = parts
        timestamp = int(timestamp_str)

        # Check expiry (24h)
        if time.time() - timestamp > HITL_TOKEN_EXPIRY_HOURS * 3600:
            _log("expired")
            return False

        message = f"{run_id}:{gate}:{timestamp}"
        expected_sig = hmac.new(HITL_SECRET, message.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            _log("signature-mismatch")
            return False
        return True
    except (TypeError, ValueError):
        _log("invalid-format")
        return False


def _load_run_payload(run: Mapping[str, Any]) -> dict[str, Any]:
    payload = run.get("payload")
    if payload is None:
        return {}
    if isinstance(payload, str):
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return {}
        if isinstance(data, Mapping):
            return dict(data)
        return {}
    if isinstance(payload, Mapping):
        return dict(payload)
    return {}


@router.get("/approve/{run_id}/{gate}")
async def approve_gate(
    request: Request,
    run_id: str,
    gate: Literal["ideate", "prepublish"],
    db: Annotated[Database, Depends(get_database)],
    orchestrator: Annotated[OrchestratorClient, Depends(get_orchestrator_client)],
    _: Annotated[None, Depends(rate_limit_dependency("hitl_approve"))],
    token: str | None = Query(None, description="Signed approval token"),
) -> Any:
    """Approve a HITL gate for a given run.

    Requires signed token (generated on interrupt) or API key authentication.
    Records approval artifact with audit info (IP, timestamp).
    """
    # Validate run exists
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    
    # Verify token if provided, otherwise require API key (handled by middleware)
    if token:
        if not verify_approval_token(token, run_id, gate):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid or expired token")
    # If no token, API key middleware will enforce auth

    approver_ip = request.client.host if request.client else None
    db.record_hitl_approval(run_id=run_id, gate=str(gate), approver_ip=approver_ip)
    run_payload = _load_run_payload(run)
    project = str(run.get("project") or "")
    try:
        payload: dict[str, object] = {
            "project": project,
            "input": None,
            "videos": [],
            "metadata": {"approveGate": str(gate)},
            "resume": {"approved": True, "gate": str(gate)},
        }
        response = orchestrator.invoke(run_id, payload, background=True)
        state = response.get("state") or {}
        if isinstance(state, Mapping) and state.get("completed"):
            result_block = {
                "status": "published",
                "publishUrls": list(state.get("publishUrls") or []),
                "videos": list(state.get("videos") or []),
                "artifacts": list(state.get("artifacts") or []),
            }
            try:
                db.update_run(run_id=run_id, status="published", result=result_block)
            except Exception as exc:  # pragma: no cover - DB implementations optional
                logger.warning(
                    "Failed to update run status after gate approval",
                    extra={"run_id": run_id, "project": project, "gate": gate, "error": str(exc)},
                )
    except Exception as exc:  # pragma: no cover - exercised via API tests
        _raise_hitl_error(
            exc,
            run_id=run_id,
            gate=gate,
            project=project,
            action="resume",
        )
    response_payload = {"status": "approved", "runId": run_id, "gate": str(gate)}
    accept_header = request.headers.get("accept", "")
    if "text/html" in accept_header:
        created_at = datetime.now(UTC).isoformat()
        html = f"""
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Run {run_id} – {gate} approval</title>
          </head>
          <body>
            <h1>HITL approval recorded</h1>
            <p>Run ID: <code>{run_id}</code></p>
            <p>Project: <code>{project}</code></p>
            <p>Gate: <code>{gate}</code></p>
            <p>Status: <strong>approved</strong></p>
            <p>Timestamp: <code>{created_at}</code></p>
            <p>This gate has been approved. You may safely close this window.</p>
            <button type="button" disabled>Approved</button>
          </body>
        </html>
        """
        return HTMLResponse(content=html, status_code=status.HTTP_200_OK)
    return response_payload


@router.get("/link/{run_id}/{gate}")
async def get_approval_link(
    run_id: str,
    gate: Literal["ideate", "prepublish"],
    db: Annotated[Database, Depends(get_database)],
) -> dict[str, str]:
    """Generate signed approval link for a HITL gate.
    
    Used when run hits an interrupt; returns URL with signed token.
    """
    # Validate run exists
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    
    token = generate_approval_token(run_id, gate)
    base_url = settings.public_base_url or "http://localhost:8080"
    approval_url = f"{base_url}/v1/hitl/approve/{run_id}/{gate}?token={token}"
    
    return {
        "runId": run_id,
        "gate": gate,
        "token": token,
        "approvalUrl": approval_url,
        "expiresIn": f"{HITL_TOKEN_EXPIRY_HOURS}h",
    }
def _raise_hitl_error(
    exc: Exception,
    *,
    run_id: str,
    gate: str,
    project: str | None,
    action: Literal["workflow", "resume"],
) -> None:
    """Log orchestrator failures with context and raise an HTTP error."""
    detail = "failed to start workflow run" if action == "workflow" else "failed to resume run"
    context = {"run_id": run_id, "gate": gate, "project": project}
    if isinstance(exc, httpx.HTTPError):
        logger.error("HITL orchestrator call failed", extra={**context, "action": action}, exc_info=exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc
    logger.exception("Unexpected HITL orchestrator failure", extra={**context, "action": action})
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail) from exc
