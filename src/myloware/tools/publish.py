"""Upload-post video publishing tool.

This tool integrates with upload-post to publish videos to TikTok.
It's used by the Publisher agent to post final videos.

Idempotency: Checks for existing published URLs for the same video_url
to prevent duplicate publishes on replay.
"""

from __future__ import annotations

from typing import Any, Dict, List
from uuid import UUID, uuid4

import httpx

from myloware.config import settings
from myloware.config.provider_modes import effective_upload_post_provider
from myloware.observability.logging import get_logger
from myloware.storage.database import get_async_session_factory
from myloware.storage.models import ArtifactType
from myloware.storage.repositories import ArtifactRepository
from myloware.tools.base import JSONSchema, MylowareBaseTool, format_tool_error, format_tool_success

logger = get_logger(__name__)

__all__ = ["UploadPostTool"]


class UploadPostTool(MylowareBaseTool):
    """Publish videos to TikTok using upload-post.

    Supports both real API calls and fake mode for testing.
    """

    def __init__(
        self,
        run_id: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 60.0,
        use_fake: bool | None = None,
        default_account_id: str = "AISMR",
    ):
        self.run_id = run_id
        self.api_key = api_key or getattr(settings, "upload_post_api_key", None)
        base_url_setting = base_url or getattr(
            settings, "upload_post_api_url", "https://api.upload-post.com"
        )
        self.base_url = (
            base_url_setting.rstrip("/") if base_url_setting else "https://api.upload-post.com"
        )
        self.timeout = timeout
        self.default_account_id = default_account_id

        provider_setting_raw = getattr(settings, "upload_post_provider", "real")
        provider_setting = (
            provider_setting_raw.lower() if isinstance(provider_setting_raw, str) else "real"
        )
        if provider_setting not in {"real", "fake", "off"}:
            raise ValueError(f"Invalid UPLOAD_POST_PROVIDER value: {provider_setting_raw}")

        if use_fake is not None:
            self.provider_mode = "fake" if use_fake else "real"
        else:
            self.provider_mode = effective_upload_post_provider(settings)

        if self.provider_mode == "off":
            raise ValueError("Upload-post provider is disabled (UPLOAD_POST_PROVIDER=off)")

        self.use_fake = self.provider_mode == "fake"

        if self.provider_mode == "real" and not self.api_key:
            raise ValueError("Upload-post API key required when UPLOAD_POST_PROVIDER=real")

        logger.info(
            "UploadPostTool initialized (run_id=%s, mode=%s, account=%s)",
            self.run_id,
            self.provider_mode,
            default_account_id,
        )

    def get_name(self) -> str:
        return "upload_post"

    def get_description(self) -> str:
        return (
            "Publish a video to TikTok using the upload-post service. "
            "Requires a video URL and caption. Returns the published TikTok URL."
        )

    def get_input_schema(self) -> JSONSchema:
        return {
            "type": "object",
            "properties": {
                "video_url": {
                    "type": "string",
                    "description": "URL of the video to publish. Must be publicly accessible.",
                },
                "caption": {
                    "type": "string",
                    "description": "Caption for the TikTok post. Keep under 150 characters.",
                },
                "tags": {
                    "type": "array",
                    "description": "List of hashtags (without # prefix). Use 3-5 tags.",
                    "items": {"type": "string"},
                },
                "account_id": {
                    "type": "string",
                    "description": "Social account ID to publish to (default: AISMR)",
                    "default": "AISMR",
                },
            },
            "required": ["video_url", "caption"],
        }

    def _validate_result(
        self, result: Dict[str, Any], allow_processing: bool = False
    ) -> Dict[str, Any]:
        """Validate upload/publish response shape (used by unit tests)."""
        status = result.get("status")
        if status == "success" and not result.get("published_url") and not result.get("url"):
            raise ValueError("published_url is required when status is success")
        if allow_processing and status == "processing" and not result.get("status_url"):
            raise ValueError("status_url required when processing")
        return result

    # run_impl inherited from base class - it wraps async_run_impl automatically

    async def _check_existing_publish(self, video_url: str) -> Dict[str, Any] | None:
        """Check if this video_url has already been published for this run_id.

        Args:
            video_url: The video URL to check

        Returns:
            Existing published URL if found, None otherwise
        """
        if not self.run_id:
            return None

        SessionLocal = get_async_session_factory()
        async with SessionLocal() as session:
            repo = ArtifactRepository(session)
            artifacts = await repo.get_by_run_async(UUID(self.run_id))

            # Look for PUBLISHED_URL artifacts with matching video_url in metadata
            for artifact in artifacts:
                if artifact.artifact_type == ArtifactType.PUBLISHED_URL.value:
                    metadata = artifact.artifact_metadata or {}
                    if metadata.get("video_url") == video_url and artifact.uri:
                        logger.info(
                            "Found existing publish for video_url=%s, returning published_url=%s",
                            video_url[:50],
                            artifact.uri,
                        )
                        return {
                            "published_url": artifact.uri,
                            "publish_id": metadata.get("publish_id"),
                            "platform": metadata.get("platform", "tiktok"),
                            "account_id": metadata.get("account_id"),
                            "from_cache": True,
                        }

        return None

    async def async_run_impl(
        self,
        video_url: str,
        caption: str,
        tags: List[str] | None = None,
        account_id: str | None = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Publish video to TikTok.

        Implements idempotency: if this video_url was already published for this run_id,
        returns the existing published_url instead of re-publishing.
        """
        if not video_url:
            raise ValueError("video_url is required")
        if not caption:
            raise ValueError("caption is required")

        # Check for existing publish (idempotency)
        if self.run_id:
            existing = await self._check_existing_publish(video_url)
            if existing:
                logger.info(
                    "Upload/publish is idempotent (video_url=%s), returning existing published_url",
                    video_url[:50],
                )
                return format_tool_success(
                    {
                        **existing,
                        "status": "published",
                        "idempotent": True,
                        "message": "Returned existing published_url (idempotent replay)",
                    },
                    message="Returned existing published URL (idempotent)",
                )

        effective_account_id = account_id or self.default_account_id
        formatted_tags = tags or []

        logger.info(
            "Publishing video to TikTok (account=%s, caption_length=%s, tags=%s)",
            effective_account_id,
            len(caption),
            len(formatted_tags),
        )

        if self.use_fake:
            result = await self._run_fake(video_url, caption, formatted_tags, effective_account_id)
        else:
            result = await self._run_real(video_url, caption, formatted_tags, effective_account_id)

        # Store video_url in result metadata for idempotency checking
        if isinstance(result, dict) and "data" in result:
            result["data"]["video_url"] = video_url

        return result

    async def _run_fake(
        self,
        video_url: str,
        caption: str,
        tags: List[str],
        account_id: str,
    ) -> Dict[str, Any]:
        """Return fake publish result for testing."""
        publish_id = f"fake-publish-{uuid4().hex[:8]}"
        published_url = f"https://tiktok.com/@{account_id.lower()}/{publish_id}"

        logger.info("Fake publish: %s -> %s", video_url, published_url)

        truncated_caption = caption if len(caption) <= 120 else caption[:117] + "..."

        return format_tool_success(
            {
                "publish_id": publish_id,
                "published_url": published_url,
                "platform": "tiktok",
                "account_id": account_id,
                "status": "published",
                "caption_used": truncated_caption,
                "tags_used": tags,
                "fake_mode": True,
            },
            message=f"Fake: Published to TikTok @{account_id.lower()}",
        )

    async def _run_real(
        self,
        video_url: str,
        caption: str,
        tags: List[str],
        account_id: str,
    ) -> Dict[str, Any]:
        """Submit real publish to upload-post API.

        Upload-Post API uses multipart/form-data:
        - POST /api/upload
        - Authorization: Apikey xxx
        - video: URL or file
        - title: caption
        - user: account ID
        - platform[]: array of platforms
        - tags[]: array of hashtags
        """
        headers = {
            "Authorization": f"Apikey {self.api_key}",
        }

        # Build multipart form data using tuples for httpx
        # This format handles array fields like platform[] and tags[]
        files_and_data = [
            ("video", (None, video_url)),
            ("title", (None, caption)),
            ("user", (None, account_id)),
            ("platform[]", (None, "tiktok")),
        ]

        for tag in tags:
            files_and_data.append(("tags[]", (None, tag)))

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/upload",
                    headers=headers,
                    files=files_and_data,
                )
        except httpx.HTTPError as exc:
            logger.error(
                "Upload-Post request error (account=%s, video_url=%s): %s",
                account_id,
                video_url[:120],
                exc,
            )
            return format_tool_error(
                "network_error",
                "Upload-Post request failed",
                {"account_id": account_id, "error": str(exc)},
            )

        status_code_raw = getattr(response, "status_code", 200)
        try:
            status_code = int(status_code_raw)
        except Exception:
            status_code = 200

        if status_code >= 400:
            body = str(getattr(response, "text", "") or "")
            if len(body) > 1200:
                body = body[:1200] + "…(truncated)…"
            logger.error(
                "Upload-Post API error (status=%s, account=%s, video_url=%s): %s",
                status_code,
                account_id,
                video_url[:120],
                body,
            )
            return format_tool_error(
                "http_error",
                f"Upload-Post returned HTTP {status_code}",
                {
                    "status_code": status_code,
                    "account_id": account_id,
                    "detail": body,
                },
            )

        try:
            data = response.json()
        except Exception as exc:
            logger.error("Upload-Post returned non-JSON response: %s", exc)
            return format_tool_error(
                "invalid_response",
                "Upload-Post returned non-JSON response",
                {"account_id": account_id},
            )

        logger.info("Upload-Post raw response: %s", data)

        # Upload-Post processes uploads in background and returns request_id
        request_id = data.get("request_id")
        success = data.get("success", False)
        message = data.get("message", "")

        # Check if upload was immediate or backgrounded
        if request_id:
            # Background processing - return request_id for status checking
            status_url = f"{self.base_url}/api/uploadposts/status?request_id={request_id}"
            logger.info("Upload initiated in background: %s", request_id)

            truncated_caption = caption if len(caption) <= 120 else caption[:117] + "..."

            return format_tool_success(
                {
                    "request_id": request_id,
                    "status": "processing",
                    "status_url": status_url,
                    "platform": "tiktok",
                    "account_id": account_id,
                    "caption_used": truncated_caption,
                    "tags_used": tags,
                    "message": message,
                },
                message=f"Upload initiated - check status at {status_url}",
            )

        # Direct response with URL (less common)
        published_url = (
            data.get("url")
            or data.get("published_url")
            or data.get("canonicalUrl")
            or data.get("response", {}).get("url")
            or data.get("data", {}).get("url")
        )

        publish_id = data.get("id") or data.get("publish_id") or data.get("data", {}).get("id")

        status = data.get("status", "success" if success else "unknown")

        logger.info(
            "Video published successfully: %s (status=%s)", published_url or publish_id, status
        )

        truncated_caption = caption if len(caption) <= 120 else caption[:117] + "..."

        return format_tool_success(
            {
                "publish_id": publish_id,
                "published_url": published_url,
                "platform": "tiktok",
                "account_id": account_id,
                "status": status,
                "caption_used": truncated_caption,
                "tags_used": tags,
            },
            message="Video published to TikTok successfully",
        )
