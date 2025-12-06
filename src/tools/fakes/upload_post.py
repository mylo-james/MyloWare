"""Deterministic Upload-Post fake client for testing."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

__all__ = ["UploadPostFakeClient"]


@dataclass
class UploadPostFakeClient:
    """Fake upload-post client that records publish calls."""

    posts: List[Dict[str, Any]] = field(default_factory=list)

    def publish(
        self,
        *,
        video_url: str,
        caption: str,
        hashtags: list[str] | None = None,
        run_id: str | None = None,
    ) -> Dict[str, Any]:
        record = {
            "video_url": video_url,
            "caption": caption,
            "hashtags": hashtags or [],
            "run_id": run_id,
        }
        self.posts.append(record)

        post_id = f"fake-upload-{len(self.posts)}"
        return {
            "status": "published",
            "post_id": post_id,
            "url": f"https://fake.upload/{post_id}",
        }
