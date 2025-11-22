"""HTTP client to call MCP tools from Python services."""
from __future__ import annotations

import json
from typing import Any, Mapping

import httpx


class MCPClient:
    def __init__(self, *, base_url: str, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._client = httpx.Client(timeout=timeout)

    def call(self, tool_name: str, params: Mapping[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url}/tools/{tool_name}"
        headers = {"content-type": "application/json"}
        if self._api_key:
            headers["x-api-key"] = self._api_key
        response = self._client.post(url, headers=headers, content=json.dumps(dict(params)))
        text = response.text or ""
        try:
            body = json.loads(text) if text else {}
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"MCP tool '{tool_name}' returned invalid JSON: {text}") from exc
        if response.status_code >= 400:
            message = body.get("error", {}).get("message") if isinstance(body, dict) else None
            raise RuntimeError(f"MCP tool '{tool_name}' failed: {message or response.reason_phrase}")
        # Prefer structuredContent when available
        if isinstance(body, dict) and "structuredContent" in body:
            return body["structuredContent"]
        return body if isinstance(body, dict) else {"result": body}

    def close(self) -> None:
        self._client.close()

