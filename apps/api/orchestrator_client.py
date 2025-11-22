"""HTTP client for the LangGraph orchestrator service."""
from __future__ import annotations

import logging
from typing import Any, cast

import httpx

from .config import settings

logger = logging.getLogger("myloware.api.orchestrator_client")


class OrchestratorClient:
    def __init__(self, *, base_url: str | None = None, api_key: str | None = None) -> None:
        self._base_url = (base_url or settings.orchestrator_base_url).rstrip("/")
        self._api_key = api_key or settings.api_key
        timeout = httpx.Timeout(60.0, connect=10.0)
        self._client = httpx.Client(timeout=timeout)

    def invoke(self, run_id: str, payload: dict[str, Any], background: bool = True) -> dict[str, Any]:
        url = f"{self._base_url}/runs/{run_id}"
        logger.info(
            "Invoking orchestrator",
            extra={
                "run_id": run_id,
                "background": background,
                "url": url,
                "base_url": self._base_url,
            },
        )
        try:
            response = self._client.post(
                url,
                json=payload,
                params={"background": "true" if background else "false"},
                headers={"x-api-key": self._api_key},
            )
            logger.info(
                "Orchestrator responded",
                extra={
                    "run_id": run_id,
                    "status_code": response.status_code,
                    "elapsed_ms": response.elapsed.total_seconds() * 1000,
                },
            )
            response.raise_for_status()
            data = cast(dict[str, Any], response.json())
            return data
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Orchestrator HTTP error",
                extra={
                    "run_id": run_id,
                    "status_code": exc.response.status_code,
                    "response_text": exc.response.text[:500],
                },
                exc_info=exc,
            )
            raise
        except httpx.ConnectError as exc:
            logger.error(
                "Cannot connect to orchestrator",
                extra={"run_id": run_id, "url": url},
                exc_info=exc,
            )
            raise
        except Exception as exc:
            logger.error(
                "Orchestrator invocation failed",
                extra={"run_id": run_id, "error_type": type(exc).__name__},
                exc_info=exc,
            )
            raise

    def close(self) -> None:
        self._client.close()

    def chat_brendan(self, *, user_id: str, message: str) -> dict[str, Any]:
        """Call the orchestrator's Brendan chat endpoint.

        Returns a dict with keys like {"response": str, "run_ids": [...]}.
        """
        response = self._client.post(
            f"{self._base_url}/v1/chat/brendan",
            json={"user_id": user_id, "message": message},
            headers={"x-api-key": self._api_key},
        )
        response.raise_for_status()
        data = cast(dict[str, Any], response.json())
        return data
