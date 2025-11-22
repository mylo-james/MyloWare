"""Shotstack adapter producing deterministic timelines."""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, Mapping
from urllib.parse import urlparse

import httpx

from infrastructure.retry import run_with_retry
from infrastructure.circuit_breaker import CircuitBreaker
from adapters.persistence.cache import ResponseCache
from adapters.security.host_allowlist import ensure_host_allowed

logger = logging.getLogger("myloware.adapters.ai_providers.shotstack")


class ShotstackClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        cache: ResponseCache | None = None,
        poll_interval: float = 2.0,
        poll_timeout: float = 120.0,
        allowed_hosts: list[str] | None = None,
        allow_dev_hosts: bool = True,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(timeout=30)
        self._cache = cache
        self._cache_namespace = "shotstack"
        self._poll_interval = poll_interval
        self._poll_timeout = poll_timeout
        self._breaker = CircuitBreaker(name="shotstack")
        self._allowed_hosts = allowed_hosts or [
            "api.shotstack.io",
            "api.shotstack.com",
        ]
        self._allow_dev_hosts = allow_dev_hosts
        self._validate_base_url()

    def _validate_base_url(self) -> None:
        """Ensure the base URL is restricted to known-safe hosts in non-test envs."""
        parsed = urlparse(self._base_url)
        host = parsed.hostname or ""
        ensure_host_allowed(
            host,
            self._allowed_hosts,
            component="ShotstackClient base_url",
            allow_dev_hosts=self._allow_dev_hosts,
        )

    def render(self, timeline: dict[str, Any]) -> dict[str, Any]:
        logger.info("Submitting Shotstack render")

        cache_key: Mapping[str, Any] = {"timeline": timeline}
        if self._cache:
            cached = self._cache.get(self._cache_namespace, cache_key)
            if cached:
                logger.info("Returning cached Shotstack render result")
                return json.loads(json.dumps(cached))

        # Derive a deterministic idempotency key from the timeline so that
        # upstream retries remain safe at the provider boundary.
        idempotency_source = json.dumps(timeline, sort_keys=True)
        idempotency_key = hashlib.sha256(idempotency_source.encode("utf-8")).hexdigest()

        def _call() -> dict[str, Any]:
            response = self._client.post(
                f"{self._base_url}/render",
                json=timeline,
                headers={
                    "x-api-key": self._api_key,
                    "Idempotency-Key": idempotency_key,
                },
            )
            response.raise_for_status()
            return response.json()

        def _with_retry() -> dict[str, Any]:
            return run_with_retry(_call)

        result = self._breaker.call(_with_retry)
        final_result = self._ensure_render_result(result)

        if self._cache:
            try:
                self._cache.set(self._cache_namespace, cache_key, json.loads(json.dumps(final_result)))
            except Exception:  # pragma: no cover - cache failures shouldn't bubble
                logger.warning("Failed to persist Shotstack cache entry", exc_info=True)

        return final_result

    def close(self) -> None:
        self._client.close()

    def _ensure_render_result(self, initial: dict[str, Any]) -> dict[str, Any]:
        """Poll Shotstack until the render produces a URL."""
        url = _extract_shotstack_url(initial)
        if url:
            return initial

        job_id = _extract_shotstack_job_id(initial)
        if not job_id:
            raise ValueError("Shotstack response missing url and job id")

        logger.info("Polling Shotstack render", extra={"job_id": job_id})
        final = self._poll_render(job_id)
        response_block = final.get("response")
        if isinstance(response_block, Mapping):
            if response_block.get("url"):
                final["url"] = response_block["url"]
            if job_id and "id" not in response_block:
                response_block = dict(response_block)
                response_block["id"] = job_id
                final["response"] = response_block
        if job_id and "renderId" not in final:
            final["renderId"] = job_id
        return final

    def _poll_render(self, job_id: str) -> dict[str, Any]:
        """Poll Shotstack for render completion."""
        deadline = time.monotonic() + self._poll_timeout
        last_response: dict[str, Any] | None = None
        url = f"{self._base_url}/render/{job_id}"
        headers = {"x-api-key": self._api_key}
        while time.monotonic() < deadline:
            response = self._client.get(url, headers=headers)
            response.raise_for_status()
            body: dict[str, Any] = response.json()
            last_response = body
            block = body.get("response") or {}
            status = str(block.get("status") or "").lower()
            if status in {"done", "success", "completed"}:
                return body
            if status in {"failed", "error"}:
                raise RuntimeError(f"Shotstack render {job_id} failed: {block.get('error')}")
            time.sleep(self._poll_interval)
        raise TimeoutError(f"Timed out waiting for Shotstack render {job_id}; last status={last_response}")


def _extract_shotstack_url(payload: Mapping[str, Any] | None) -> str | None:
    if not isinstance(payload, Mapping):
        return None
    url = payload.get("url")
    if url:
        return str(url)
    output = payload.get("output")
    if isinstance(output, Mapping):
        if output.get("url"):
            return str(output["url"])
    response_block = payload.get("response")
    if isinstance(response_block, Mapping):
        if response_block.get("url"):
            return str(response_block["url"])
        nested_output = response_block.get("output")
        if isinstance(nested_output, Mapping) and nested_output.get("url"):
            return str(nested_output["url"])
    return None


def _extract_shotstack_job_id(payload: Mapping[str, Any] | None) -> str | None:
    if not isinstance(payload, Mapping):
        return None
    response_block = payload.get("response")
    if isinstance(response_block, Mapping):
        if response_block.get("id"):
            return str(response_block["id"])
        # Some Shotstack environments return a renderId field instead of id.
        if response_block.get("renderId"):
            return str(response_block["renderId"])
    if payload.get("id"):
        return str(payload["id"])
    if payload.get("renderId"):
        return str(payload["renderId"])
    return None

__all__ = ["ShotstackClient"]
