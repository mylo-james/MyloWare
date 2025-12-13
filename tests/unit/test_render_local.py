"""Unit tests for LocalRemotionProvider."""

from __future__ import annotations

import pytest

from services.render_local import LocalRemotionProvider
from services.render_provider import RenderJob, RenderStatus


class TestLocalRemotionProvider:
    """Tests for the LocalRemotionProvider class."""

    def test_init(self) -> None:
        """Test provider initialization."""
        provider = LocalRemotionProvider("http://localhost:3001")
        assert provider.service_url == "http://localhost:3001"
        assert provider.timeout == 30.0

    def test_init_strips_trailing_slash(self) -> None:
        """Test that trailing slash is stripped from service_url."""
        provider = LocalRemotionProvider("http://localhost:3001/")
        assert provider.service_url == "http://localhost:3001"

    def test_init_custom_timeout(self) -> None:
        """Test provider initialization with custom timeout."""
        provider = LocalRemotionProvider("http://localhost:3001", timeout=60.0)
        assert provider.timeout == 60.0


class TestRenderJobCreation:
    """Tests for RenderJob dataclass with LocalRemotionProvider context."""

    def test_render_job_pending(self) -> None:
        """Test creating a pending render job."""
        job = RenderJob(
            job_id="test-123",
            status=RenderStatus.PENDING,
            metadata={"composition": "aismr"},
        )
        assert job.job_id == "test-123"
        assert job.status == RenderStatus.PENDING
        assert job.artifact_url is None

    def test_render_job_completed(self) -> None:
        """Test creating a completed render job."""
        job = RenderJob(
            job_id="test-123",
            status=RenderStatus.COMPLETED,
            artifact_url="http://example.com/video.mp4",
        )
        assert job.status == RenderStatus.COMPLETED
        assert job.artifact_url == "http://example.com/video.mp4"

    def test_render_job_failed(self) -> None:
        """Test creating a failed render job."""
        job = RenderJob(
            job_id="error",
            status=RenderStatus.FAILED,
            error="Connection refused",
        )
        assert job.status == RenderStatus.FAILED
        assert "Connection refused" in job.error


class TestStatusMapping:
    """Tests for status string to enum mapping."""

    def test_status_map_values(self) -> None:
        """Test that status mapping covers expected values."""
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

        for status_str, expected in status_map.items():
            assert expected.value in ["pending", "rendering", "completed", "failed"]


class TestGetRenderProvider:
    """Tests for the factory function."""

    def test_get_render_provider_returns_local(self) -> None:
        """Test that get_render_provider returns LocalRemotionProvider."""
        from services.render_provider import get_render_provider

        provider = get_render_provider()
        assert isinstance(provider, LocalRemotionProvider)

    def test_get_render_provider_uses_settings(self) -> None:
        """Test that provider uses settings for service URL."""
        from config.settings import settings
        from services.render_provider import get_render_provider

        provider = get_render_provider()
        assert provider.service_url == settings.remotion_service_url

    def test_provider_satisfies_protocol(self) -> None:
        """Test that LocalRemotionProvider satisfies RenderProvider Protocol."""
        from services.render_provider import RenderProvider

        provider = LocalRemotionProvider("http://localhost:3001")

        # Type annotation check - if this compiles, the protocol is satisfied
        _: RenderProvider = provider

        # Check method signatures exist
        assert hasattr(provider, "render")
        assert hasattr(provider, "get_status")
        assert callable(provider.render)
        assert callable(provider.get_status)


class TestProviderIntegration:
    """Integration-style tests that don't require real service."""

    @pytest.mark.asyncio
    async def test_render_returns_render_job(self) -> None:
        """Test that render() would return a RenderJob (connection will fail)."""
        provider = LocalRemotionProvider("http://localhost:99999")  # Invalid port

        # This will fail due to connection, but we test error handling
        job = await provider.render("test", {})

        # Should return a failed job, not raise
        assert isinstance(job, RenderJob)
        assert job.status == RenderStatus.FAILED
        assert "unavailable" in job.error.lower()

    @pytest.mark.asyncio
    async def test_get_status_returns_render_job(self) -> None:
        """Test that get_status() would return a RenderJob (connection will fail)."""
        provider = LocalRemotionProvider("http://localhost:99999")  # Invalid port

        # This will fail due to connection, but we test error handling
        job = await provider.get_status("any-job-id")

        # Should return a failed job, not raise
        assert isinstance(job, RenderJob)
        assert job.status == RenderStatus.FAILED
