"""Upload-post video publishing tool.

This tool integrates with upload-post to publish videos to TikTok.
It's used by the Publisher agent to post final videos.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List
from uuid import uuid4

import httpx

from config import settings
from tools.base import (
    MylowareBaseTool,
    ToolParamDefinition,
    format_tool_success,
)

logger = logging.getLogger(__name__)

__all__ = ["UploadPostTool"]


class UploadPostTool(MylowareBaseTool):
    """Publish videos to TikTok using upload-post.
    
    Supports both real API calls and fake mode for testing.
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 60.0,
        use_fake: bool | None = None,
        default_account_id: str = "AISMR",
    ):
        self.api_key = api_key or getattr(settings, "upload_post_api_key", None)
        base_url_setting = base_url or getattr(settings, "upload_post_api_url", "https://api.upload-post.com")
        self.base_url = base_url_setting.rstrip("/") if base_url_setting else "https://api.upload-post.com"
        self.timeout = timeout
        self.default_account_id = default_account_id
        
        if use_fake is None:
            self.use_fake = getattr(settings, "use_fake_providers", False)
        else:
            self.use_fake = use_fake
            
        if not self.use_fake and not self.api_key:
            raise ValueError("Upload-post API key required when not using fake providers")
            
        logger.info(
            "UploadPostTool initialized (fake=%s, account=%s)",
            self.use_fake,
            default_account_id,
        )

    def get_name(self) -> str:
        return "upload_post"

    def get_description(self) -> str:
        return (
            "Publish a video to TikTok using the upload-post service. "
            "Requires a video URL and caption. Returns the published TikTok URL."
        )

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "video_url": ToolParamDefinition(
                param_type="str",
                description="URL of the video to publish. Must be publicly accessible.",
                required=True,
            ),
            "caption": ToolParamDefinition(
                param_type="str",
                description="Caption for the TikTok post. Keep under 150 characters.",
                required=True,
            ),
            "tags": ToolParamDefinition(
                param_type="list",
                description="List of hashtags (without # prefix). Use 3-5 tags.",
                required=False,
            ),
            "account_id": ToolParamDefinition(
                param_type="str",
                description="Social account ID to publish to (default: AISMR)",
                required=False,
                default="AISMR",
            ),
        }

    def run_impl(
        self,
        video_url: str,
        caption: str,
        tags: List[str] | None = None,
        account_id: str | None = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Publish video to TikTok."""
        if not video_url:
            raise ValueError("video_url is required")
        if not caption:
            raise ValueError("caption is required")

        effective_account_id = account_id or self.default_account_id
        formatted_tags = tags or []

        logger.info(
            "Publishing video to TikTok (account=%s, caption_length=%s, tags=%s)",
            effective_account_id,
            len(caption),
            len(formatted_tags),
        )

        if self.use_fake:
            return self._run_fake(
                video_url, caption, formatted_tags, effective_account_id
            )
        return self._run_real(
            video_url, caption, formatted_tags, effective_account_id
        )

    def _run_fake(
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

    def _run_real(
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

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                f"{self.base_url}/api/upload",
                headers=headers,
                files=files_and_data,
            )
            response.raise_for_status()
            data = response.json()

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

        publish_id = (
            data.get("id")
            or data.get("publish_id")
            or data.get("data", {}).get("id")
        )
        
        status = data.get("status", "success" if success else "unknown")

        logger.info("Video published successfully: %s (status=%s)", published_url or publish_id, status)

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
