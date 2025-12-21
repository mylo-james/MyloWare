"""Local Remotion render provider implementation.

This module provides a RenderProvider implementation that wraps the
self-hosted remotion-service for video rendering.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import httpx

from myloware.config import settings
from myloware.observability.logging import get_logger
from myloware.services.render_provider import RenderJob, RenderProvider, RenderStatus

logger = get_logger(__name__)

__all__ = ["LocalRemotionProvider"]


class LocalRemotionProvider:
    """RenderProvider implementation wrapping self-hosted remotion-service.

    This provider submits render jobs to a local Remotion service running
    on the specified URL. It implements the RenderProvider Protocol.

    Attributes:
        service_url: Base URL of the remotion-service (e.g., http://localhost:3001)
        timeout: HTTP timeout in seconds for service calls

    Example:
        provider = LocalRemotionProvider("http://localhost:3001")
        job = await provider.render(
            composition="aismr",
            props={"clips": [...], "objects": [...]},
            webhook_url="https://myapp.com/webhooks/remotion",
        )
        status = await provider.get_status(job.job_id)
    """

    def __init__(
        self,
        service_url: str,
        timeout: float = 30.0,
    ) -> None:
        """Initialize the LocalRemotionProvider.

        Args:
            service_url: Base URL of the remotion-service
            timeout: HTTP timeout in seconds (default: 30.0)
        """
        self.service_url = service_url.rstrip("/")
        self.timeout = timeout
        self.api_secret = str(getattr(settings, "remotion_api_secret", "") or "").strip()

    def _auth_headers(self) -> dict[str, str] | None:
        if not self.api_secret:
            return None
        return {"Authorization": f"Bearer {self.api_secret}", "x-api-key": self.api_secret}

    async def render(
        self,
        composition: str,
        props: dict[str, Any],
        webhook_url: str | None = None,
    ) -> RenderJob:
        """Submit a render job to the local Remotion service.

        Sends a POST request to the remotion-service /api/render endpoint
        with the composition and props. The service queues the render and
        returns a job_id for tracking.

        Args:
            composition: Remotion composition ID (e.g., "aismr", "test")
            props: Props to pass to the composition. For the AISMR template:
                - clips: List of video URLs
                - objects: List of object names for overlays
                - duration_frames: Total frames
                - fps: Frame rate
                - width/height: Dimensions
            webhook_url: URL to POST when render completes. The webhook
                receives {"job_id", "status", "artifact_url"}.

        Returns:
            RenderJob with:
            - job_id: Unique job identifier
            - status: PENDING (job queued)
            - metadata: Original request data

        Raises:
            httpx.HTTPStatusError: If service returns non-2xx status
            httpx.ConnectError: If service is unavailable (returns FAILED job)
        """
        payload = {
            "template": composition,
            "callback_url": webhook_url,
            **props,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.service_url}/api/render",
                    json=payload,
                    headers=self._auth_headers(),
                )
                resp.raise_for_status()
                data = resp.json()

            job_id = data.get("job_id") or data.get("jobId") or str(uuid4())

            logger.info(
                "remotion_render_submitted",
                job_id=job_id,
                composition=composition,
                webhook_url=webhook_url,
            )

            return RenderJob(
                job_id=job_id,
                status=RenderStatus.PENDING,
                metadata={
                    "composition": composition,
                    "service_url": self.service_url,
                },
            )

        except httpx.ConnectError as e:
            logger.error(
                "remotion_service_unavailable",
                service_url=self.service_url,
                error=str(e),
            )
            return RenderJob(
                job_id="error",
                status=RenderStatus.FAILED,
                error=f"Remotion service unavailable: {e}",
            )

        except httpx.HTTPStatusError as e:
            logger.error(
                "remotion_render_failed",
                status_code=e.response.status_code,
                error=str(e),
            )
            return RenderJob(
                job_id="error",
                status=RenderStatus.FAILED,
                error=f"Remotion service error: {e.response.status_code}",
            )

    async def get_status(self, job_id: str) -> RenderJob:
        """Get current status of a render job.

        Polls the remotion-service /api/render/{job_id} endpoint to
        get the current state of a previously submitted render job.

        Args:
            job_id: Job ID returned from render()

        Returns:
            RenderJob with:
            - job_id: Same as input
            - status: Current status (PENDING, RENDERING, COMPLETED, FAILED)
            - artifact_url: Video URL when COMPLETED
            - error: Error message when FAILED

        Raises:
            httpx.HTTPStatusError: If service returns non-2xx status
            httpx.ConnectError: If service is unavailable (returns FAILED job)
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{self.service_url}/api/render/{job_id}",
                    headers=self._auth_headers(),
                )
                resp.raise_for_status()
                data = resp.json()

            # Map service status to RenderStatus enum
            status_str = data.get("status", "pending").lower()
            status_map = {
                "pending": RenderStatus.PENDING,
                "queued": RenderStatus.PENDING,
                "rendering": RenderStatus.RENDERING,
                "processing": RenderStatus.RENDERING,
                "completed": RenderStatus.COMPLETED,
                "done": RenderStatus.COMPLETED,
                "failed": RenderStatus.FAILED,
                "error": RenderStatus.FAILED,
            }
            status = status_map.get(status_str, RenderStatus.PENDING)

            return RenderJob(
                job_id=job_id,
                status=status,
                artifact_url=data.get("artifact_url")
                or data.get("output_url")
                or data.get("outputUrl"),
                error=data.get("error"),
                metadata=data,
            )

        except httpx.ConnectError as e:
            logger.error(
                "remotion_service_unavailable",
                job_id=job_id,
                error=str(e),
            )
            return RenderJob(
                job_id=job_id,
                status=RenderStatus.FAILED,
                error=f"Remotion service unavailable: {e}",
            )

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return RenderJob(
                    job_id=job_id,
                    status=RenderStatus.FAILED,
                    error=f"Job not found: {job_id}",
                )
            logger.error(
                "remotion_status_failed",
                job_id=job_id,
                status_code=e.response.status_code,
                error=str(e),
            )
            return RenderJob(
                job_id=job_id,
                status=RenderStatus.FAILED,
                error=f"Remotion service error: {e.response.status_code}",
            )


# Type check: ensure LocalRemotionProvider satisfies RenderProvider Protocol
_provider: RenderProvider = LocalRemotionProvider("http://localhost:3001")
