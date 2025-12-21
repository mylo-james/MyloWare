"""Render provider abstraction for video rendering backends.

This module defines the interface for video rendering providers,
allowing different backends (local Remotion, Lambda, etc.) to be
swapped without changing workflow code.

Example usage:
    provider = get_render_provider()
    job = await provider.render("aismr", {"title": "Hello"})
    status = await provider.get_status(job.job_id)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

__all__ = [
    "RenderStatus",
    "RenderJob",
    "RenderProvider",
    "get_render_provider",
]


class RenderStatus(str, Enum):
    """Status of a render job.

    Attributes:
        PENDING: Job created but not yet started
        RENDERING: Job is actively being processed
        COMPLETED: Job finished successfully
        FAILED: Job encountered an error
    """

    PENDING = "pending"
    RENDERING = "rendering"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class RenderJob:
    """Result of a render operation.

    Attributes:
        job_id: Unique identifier for the render job
        status: Current status of the job
        artifact_url: URL to download the rendered artifact (set when COMPLETED)
        error: Error message if job FAILED
        metadata: Additional provider-specific data
    """

    job_id: str
    status: RenderStatus
    artifact_url: str | None = None
    error: str | None = None
    metadata: dict[str, Any] | None = None


class RenderProvider(Protocol):
    """Abstract interface for video rendering backends.

    Implementations of this Protocol provide video rendering services.
    The interface is designed to be async to support both local and
    remote rendering backends without blocking.

    Known implementations:
        - LocalRemotionProvider: Wraps self-hosted remotion-service (Story 2.2)
        - LambdaRemotionProvider: Uses Remotion Lambda API (future)

    Example:
        class LocalRemotionProvider:
            async def render(self, composition, props, webhook_url=None):
                # Submit to local remotion-service
                return RenderJob(job_id="abc", status=RenderStatus.PENDING)

            async def get_status(self, job_id):
                # Poll local remotion-service for status
                return RenderJob(job_id=job_id, status=RenderStatus.COMPLETED)

        # Type checking ensures implementation matches Protocol
        provider: RenderProvider = LocalRemotionProvider()
    """

    async def render(
        self,
        composition: str,
        props: dict[str, Any],
        webhook_url: str | None = None,
    ) -> RenderJob:
        """Start a render job.

        Submits a video rendering job to the backend. The job runs
        asynchronously and can be polled via get_status() or configured
        to call a webhook when complete.

        Args:
            composition: Remotion composition ID (e.g., "aismr", "test")
            props: Props to pass to the composition. Structure depends
                on the composition's prop types.
            webhook_url: Optional URL to POST when render completes.
                The webhook payload includes job_id, status, and artifact_url.

        Returns:
            RenderJob with job_id and initial PENDING status.

        Raises:
            ConnectionError: If unable to reach the render backend
            ValueError: If composition doesn't exist or props invalid
        """
        ...

    async def get_status(self, job_id: str) -> RenderJob:
        """Get current status of a render job.

        Polls the render backend for the current status of a previously
        submitted job. When status is COMPLETED, artifact_url will be set.

        Args:
            job_id: ID returned from render()

        Returns:
            RenderJob with current status:
            - PENDING: Job queued but not started
            - RENDERING: Job is processing
            - COMPLETED: Job done, artifact_url contains video URL
            - FAILED: Job failed, error contains message

        Raises:
            ValueError: If job_id doesn't exist
            ConnectionError: If unable to reach the render backend
        """
        ...


def get_render_provider() -> RenderProvider:
    """Factory function to get the configured render provider.

    Returns the appropriate RenderProvider implementation based on
    the RENDER_PROVIDER configuration setting.

    Currently supported providers:
        - "local": LocalRemotionProvider (self-hosted remotion-service)

    Future providers:
        - "lambda": LambdaRemotionProvider (Remotion Lambda API)

    Returns:
        Configured RenderProvider instance

    Raises:
        ValueError: If configured provider is unknown
        ImportError: If provider implementation not available

    Example:
        provider = get_render_provider()
        job = await provider.render("aismr", {"clips": [...], "title": "Test"})
    """
    from myloware.config.settings import settings

    provider_type = getattr(settings, "render_provider", "local")

    if provider_type == "local":
        from myloware.services.render_local import LocalRemotionProvider

        return LocalRemotionProvider(settings.remotion_service_url)

    raise ValueError(f"Unknown render provider: {provider_type}")
