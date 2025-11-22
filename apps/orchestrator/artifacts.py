"""Helpers to persist orchestrator artifacts via the API."""
from __future__ import annotations

import logging
from typing import Iterable, Mapping

import httpx

from .config import settings

logger = logging.getLogger("myloware.orchestrator.artifacts")
_CLIENT: httpx.Client | None = None


def _client() -> httpx.Client:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = httpx.Client(timeout=5.0)
    return _CLIENT


def record_artifacts(run_id: str | None, artifacts: Iterable[Mapping[str, object]]) -> None:
    if not settings.artifact_sync_enabled:
        return
    if not run_id:
        return
    base_url = settings.api_base_url.rstrip("/")
    url = f"{base_url}/v1/runs/{run_id}/artifacts"
    headers = {"x-api-key": settings.api_key, "content-type": "application/json"}
    client = _client()
    for artifact in artifacts:
        payload = {
            "type": artifact.get("type") or "orchestrator.event",
            "provider": artifact.get("provider") or "orchestrator",
            "url": artifact.get("url") or artifact.get("renderUrl") or artifact.get("assetUrl"),
            "checksum": artifact.get("checksum"),
            "metadata": dict(artifact),
        }
        try:
            client.post(url, json=payload, headers=headers)
        except Exception as exc:  # pragma: no cover - best-effort logging
            logger.warning("Failed to record artifact", extra={"run_id": run_id, "error": str(exc)})
