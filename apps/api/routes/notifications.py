"""Notification endpoints for production graph → Brendan communication."""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from adapters.observability.sentry import capture_exception

from ..config import get_settings
from ..deps import get_database
from ..integrations import telegram as telegram_integration
from ..routes.hitl import generate_approval_token
from ..storage import Database

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])
logger = logging.getLogger("myloware.api.notifications")
settings = get_settings()


class NotificationPayload(BaseModel):
    notification_type: str
    message: str
    gate: str | None = None
    project: str | None = None


@router.post("/graph/{run_id}")
async def notify_brendan(
    run_id: str,
    payload: NotificationPayload,
    db: Annotated[Database, Depends(get_database)],
) -> dict[str, str | None]:
    """Receive notification from production graph and forward to Brendan's conversation.
    
    This endpoint is called when a production graph hits a checkpoint, interrupt, or completes.
    The notification is stored and will be picked up by Brendan in the next conversation turn.
    """
    notification_type = payload.notification_type
    message = payload.message
    gate = payload.gate
    project = payload.project
    
    # Validate run exists
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    
    # Extract user_id from run payload (set when graph was started)
    user_id = None
    payload_value = run.get("payload")
    if isinstance(payload_value, str):
        import json

        run_payload = json.loads(payload_value)
    elif isinstance(payload_value, dict):
        run_payload = payload_value
    else:
        run_payload = None

    if isinstance(run_payload, dict):
        user_id = run_payload.get("user_id")
    
    if not user_id:
        # Fallback: use run_id as user_id (for testing)
        user_id = f"user_{run_id[:8]}"
    
    # Store notification in Brendan's conversation state
    # This will be picked up by Brendan in the next conversation turn
    # For now, we'll store it as an artifact and Brendan will check for notifications
    
    # Create notification artifact
    db.create_artifact(
        run_id=run_id,
        artifact_type="notification",
        url=None,
        provider="orchestrator",
        checksum=None,
        metadata={
            "type": notification_type,
            "message": message,
            "user_id": user_id,
            "run_id": run_id,
            "gate": gate,
            "project": project,
        }
    )
    
    await _notify_external_channels(
        user_id=user_id,
        run_id=run_id,
        gate=gate,
        project=project,
        message=message,
        notification_type=notification_type,
    )

    return {
        "status": "notified",
        "run_id": run_id,
        "user_id": user_id,
        "notification_type": notification_type,
        "gate": gate,
        "project": project,
    }


async def _notify_external_channels(
    *,
    user_id: str | None,
    run_id: str,
    gate: str | None,
    project: str | None,
    message: str,
    notification_type: str,
) -> None:
    if not user_id or not user_id.startswith("telegram_"):
        return

    chat_id = user_id.replace("telegram_", "", 1)
    if not chat_id:
        return

    text_lines = [message]
    if gate in {"ideate", "prepublish"}:
        try:
            token = generate_approval_token(run_id, gate)
            base_url = (settings.public_base_url or settings.webhook_base_url).rstrip("/")
            approval_url = f"{base_url}/v1/hitl/approve/{run_id}/{gate}?token={token}"
            text_lines.extend([
                "",
                f"Approve gate ({gate}): {approval_url}",
                "Tap once the link opens to record approval, then reply here if you need another status update.",
            ])
        except Exception as exc:  # pragma: no cover - defensive, token gen already tested
            capture_exception(exc)
            logger.error(
                "Failed to generate approval URL",
                extra={"run_id": run_id, "gate": gate, "project": project},
                exc_info=True,
            )
    elif notification_type == "completed":
        text_lines.append("")
        text_lines.append("Run completed. Brendan will reply with publish URLs shortly.")

    try:
        await telegram_integration.send_telegram_message(chat_id, "\n".join(text_lines))
    except Exception as exc:  # pragma: no cover - network failures logged elsewhere
        capture_exception(exc)
        logger.error(
            "Failed to deliver Telegram notification",
            extra={"run_id": run_id, "gate": gate, "project": project},
            exc_info=True,
        )
