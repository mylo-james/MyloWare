"""upload-post adapter."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import httpx
from urllib.parse import urlparse

from adapters.persistence.cache import ResponseCache
from infrastructure.retry import run_with_retry
from infrastructure.circuit_breaker import CircuitBreaker
from adapters.security.host_allowlist import ensure_host_allowed


_DEFAULT_ALLOWED_HOSTS = [
    "api.upload-post.com",
    "api.upload-post.dev",
    "upload-post.myloware.com",
]

logger = logging.getLogger("myloware.adapters.social.upload_post")


DEFAULT_UPLOAD_POST_TIMEOUT = httpx.Timeout(120.0)


class UploadPostClient:
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
        self._client = httpx.Client(timeout=DEFAULT_UPLOAD_POST_TIMEOUT)
        self._cache = cache
        self._cache_namespace = "uploadpost"
        self._breaker = CircuitBreaker(name="upload_post")
        self._allowed_hosts = list(allowed_hosts) if allowed_hosts else list(_DEFAULT_ALLOWED_HOSTS)
        self._allow_dev_hosts = allow_dev_hosts
        self._validate_base_url()

    def _validate_base_url(self) -> None:
        """Ensure the base URL is restricted to known-safe hosts in non-test envs."""
        parsed = urlparse(self._base_url)
        host = parsed.hostname or ""
        ensure_host_allowed(
            host,
            self._allowed_hosts,
            component="UploadPostClient base_url",
            allow_dev_hosts=self._allow_dev_hosts,
        )

    def _checksum_file(self, path: Path) -> str:
        """Compute SHA-256 checksum of a file."""
        sha = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(8192):
                sha.update(chunk)
        return sha.hexdigest()

    def publish(
        self,
        *,
        video_path: Path,
        caption: str,
        account_id: str | None = None,
        title: str | None = None,
        platforms: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        # Compute cache key from video checksum, caption, and account_id
        video_checksum = self._checksum_file(video_path)
        cache_key: Mapping[str, Any] = {
            "video_checksum": video_checksum,
            "caption": caption,
            "account_id": account_id,
            "title": title or caption,
            "platforms": list(platforms) if platforms else None,
        }

        idempotency_source = json.dumps(cache_key, sort_keys=True)
        idempotency_key = hashlib.sha256(idempotency_source.encode("utf-8")).hexdigest()

        # Check cache first
        if self._cache:
            cached = self._cache.get(self._cache_namespace, cache_key)
            if cached:
                logger.info("Returning cached upload-post publish result", extra={"video": str(video_path)})
                return json.loads(json.dumps(cached))

        platform_values = list(platforms) if platforms else ["tiktok"]
        video_handle = video_path.open("rb")
        multipart: list[tuple[str, Any]] = [
            (
                "video",
                (
                    video_path.name or "video.mp4",
                    video_handle,
                    "video/mp4",
                ),
            )
        ]
        if caption:
            multipart.append(("caption", (None, caption)))
        multipart.append(("title", (None, title or caption or "")))
        if account_id:
            multipart.append(("user", (None, account_id)))
        for value in platform_values:
            multipart.append(("platform[]", (None, value)))

        logger.info("Publishing via upload-post", extra={"video": str(video_path)})

        def _call() -> dict[str, Any]:
            response = self._client.post(
                f"{self._base_url}/upload",
                files=multipart,
                headers={
                    "Authorization": f"Apikey {self._api_key}",
                    **({"x-social-account-id": account_id} if account_id else {}),
                    "Idempotency-Key": idempotency_key,
                },
            )
            response.raise_for_status()
            return response.json()

        try:
            def _with_retry() -> dict[str, Any]:
                return run_with_retry(_call)

            result = self._breaker.call(_with_retry)
            # Cache the successful response
            if self._cache:
                self._cache.set(self._cache_namespace, cache_key, json.loads(json.dumps(result)))
            return result
        finally:
            video_handle.close()

    def verify_signature(self, payload: bytes, signature: str | None) -> bool:
        if not signature:
            return False
        digest = hmac.new(self._signing_secret, payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(digest, signature)

    def close(self) -> None:
        self._client.close()
