"""kie.ai API adapter."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any, Mapping

import httpx
from urllib.parse import urlparse

from infrastructure.retry import run_with_retry
from infrastructure.circuit_breaker import CircuitBreaker
from adapters.persistence.cache import ResponseCache
from adapters.security.host_allowlist import ensure_host_allowed

logger = logging.getLogger("myloware.adapters.ai_providers.kieai")


class KieAIClient:
    """Thin wrapper around the kie.ai REST API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        signing_secret: str,
        cache: ResponseCache | None = None,
        allowed_hosts: list[str] | None = None,
        allow_dev_hosts: bool = True,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._signing_secret = signing_secret.encode()
        self._client = httpx.Client(timeout=30)
        self._cache = cache
        self._cache_namespace = "kieai"
        self._breaker = CircuitBreaker(name="kieai")
        self._allowed_hosts = allowed_hosts or [
            "api.kie.ai",
            "staging-api.kie.ai",
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
            component="KieAIClient base_url",
            allow_dev_hosts=self._allow_dev_hosts,
        )

    def submit_job(
        self,
        *,
        prompt: str,
        run_id: str,
        callback_url: str,
        duration: int,
        aspect_ratio: str,
        quality: str,
        model: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Submit a text-to-video generation job."""

        meta: dict[str, Any] = {"runId": run_id, **(metadata or {})}
        video_index = meta.get("videoIndex")
        if video_index is not None:
            idempotency_key = f"{run_id}:video:{video_index}"
        else:
            idempotency_key = f"{run_id}:job"

        payload = {
            "prompt": prompt,
            "model": model,
            "duration": duration,
            "quality": quality,
            "aspectRatio": aspect_ratio,
            "callBackUrl": callback_url,
            "metadata": meta,
            "idempotencyKey": idempotency_key,
        }

        cache_key: Mapping[str, Any] = {
            "prompt": prompt,
            "duration": duration,
            "quality": quality,
            "aspect_ratio": aspect_ratio,
            "model": model,
            "metadata": metadata or {},
        }
        if self._cache:
            cached = self._cache.get(self._cache_namespace, cache_key)
            if cached:
                cloned = json.loads(json.dumps(cached))
                data = cloned.setdefault("data", {})
                data["runId"] = run_id
                meta = dict(data.get("metadata") or {})
                meta["runId"] = run_id
                data["metadata"] = meta
                logger.info("Returning cached kie.ai job", extra={"run_id": run_id})
                return cloned

        logger.info(
            "Submitting kie.ai video job",
            extra={"run_id": run_id, "duration": duration, "aspect_ratio": aspect_ratio},
        )

        def _call() -> dict[str, Any]:
            response = self._client.post(
                f"{self._base_url}/generate",
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
            response.raise_for_status()
            return response.json()

        def _with_retry() -> dict[str, Any]:
            return run_with_retry(_call)

        response = self._breaker.call(_with_retry)

        if self._cache:
            sanitized = json.loads(json.dumps(response))
            data = sanitized.setdefault("data", {})
            data.pop("runId", None)
            metadata_block = dict(data.get("metadata") or {})
            metadata_block.pop("runId", None)
            data["metadata"] = metadata_block
            try:
                self._cache.set(self._cache_namespace, cache_key, sanitized)
            except Exception:  # pragma: no cover - cache failures shouldn't bubble
                logger.warning("Failed to persist kie.ai cache entry", exc_info=True)

        return response

    def verify_signature(self, payload: bytes, signature: str | None) -> bool:
        if not signature:
            return False
        digest = hmac.new(self._signing_secret, payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(digest, signature)

    def close(self) -> None:
        self._client.close()
