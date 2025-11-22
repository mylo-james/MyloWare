"""HTTP bridge to an external MCP/tools server."""
from __future__ import annotations

import json
from typing import Any, Iterable

import httpx


class MCPBridge:
    def __init__(self, *, base_url: str, api_key: str | None = None, timeout: int = 60) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key or ""
        self._client = httpx.Client(timeout=timeout)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["x-api-key"] = self._api_key
        return headers

    def video_generate(
        self,
        *,
        trace_id: str,
        provider: str,
        items: Iterable[dict[str, Any]],
        persona: str | None = None,
        dry_run: bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "traceId": trace_id,
            "caller": {"persona": persona} if persona else {},
            "kind": "video",
            "provider": provider,
            "items": list(items),
        }
        if metadata:
            payload["metadata"] = metadata
        if dry_run is not None:
            payload["dryRun"] = bool(dry_run)
        response = self._client.post(f"{self._base_url}/api/tools/video/generate", headers=self._headers(), content=json.dumps(payload))
        response.raise_for_status()
        return response.json()

    def video_edit(
        self,
        *,
        trace_id: str,
        provider: str,
        items: Iterable[dict[str, Any]],
        persona: str | None = None,
        dry_run: bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "traceId": trace_id,
            "caller": {"persona": persona} if persona else {},
            "kind": "edit",
            "provider": provider,
            "items": list(items),
        }
        if metadata:
            payload["metadata"] = metadata
        if dry_run is not None:
            payload["dryRun"] = bool(dry_run)
        response = self._client.post(f"{self._base_url}/api/tools/video/edit", headers=self._headers(), content=json.dumps(payload))
        response.raise_for_status()
        return response.json()

    def publish_tiktok(
        self,
        *,
        trace_id: str,
        provider: str,
        items: Iterable[dict[str, Any]],
        persona: str | None = None,
        dry_run: bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "traceId": trace_id,
            "caller": {"persona": persona} if persona else {},
            "kind": "publish",
            "provider": provider,
            "items": list(items),
        }
        if metadata:
            payload["metadata"] = metadata
        if dry_run is not None:
            payload["dryRun"] = bool(dry_run)
        response = self._client.post(f"{self._base_url}/api/tools/publish/tiktok", headers=self._headers(), content=json.dumps(payload))
        response.raise_for_status()
        return response.json()

    def close(self) -> None:
        self._client.close()
