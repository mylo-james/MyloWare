"""Artifact logging endpoints."""
from __future__ import annotations

from typing import Any, Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import verify_api_key
from ..deps import get_database
from ..storage import Database

router = APIRouter(prefix="/v1/runs", tags=["artifacts"], dependencies=[Depends(verify_api_key)])


class ArtifactPayload(BaseModel):
    type: str = Field(..., description="Artifact type, e.g., ideation, scripts, clips")
    provider: str = Field(default="orchestrator")
    url: str | None = None
    checksum: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    persona: str | None = Field(
        default=None,
        description="Persona responsible for the artifact (iggy, riley, alex, quinn, etc.)",
    )


@router.post("/{run_id}/artifacts")
async def create_artifact(
    run_id: str,
    payload: ArtifactPayload,
    db: Annotated[Database, Depends(get_database)],
) -> dict[str, Any]:
    """Persist an artifact emitted by the orchestrator or other services."""
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    db.create_artifact(
        run_id=run_id,
        artifact_type=payload.type,
        provider=payload.provider,
        url=payload.url,
        checksum=payload.checksum,
        metadata=payload.metadata,
        persona=payload.persona,
    )
    return {"status": "ok", "runId": run_id, "artifactType": payload.type}
