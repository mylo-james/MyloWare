"""Unit tests for render provider interface."""

from __future__ import annotations

from typing import Any

import pytest

from myloware.services.render_provider import (
    RenderJob,
    RenderProvider,
    RenderStatus,
)


class TestRenderStatus:
    """Tests for the RenderStatus enum."""

    def test_status_values(self) -> None:
        """Test enum values match expected strings."""
        assert RenderStatus.PENDING.value == "pending"
        assert RenderStatus.RENDERING.value == "rendering"
        assert RenderStatus.COMPLETED.value == "completed"
        assert RenderStatus.FAILED.value == "failed"

    def test_status_is_string_enum(self) -> None:
        """Test that RenderStatus is a string enum."""
        assert isinstance(RenderStatus.PENDING, str)
        assert RenderStatus.PENDING == "pending"


class TestRenderJob:
    """Tests for the RenderJob dataclass."""

    def test_render_job_basic_instantiation(self) -> None:
        """Test creating a RenderJob with required fields only."""
        job = RenderJob(job_id="abc-123", status=RenderStatus.PENDING)

        assert job.job_id == "abc-123"
        assert job.status == RenderStatus.PENDING
        assert job.artifact_url is None
        assert job.error is None
        assert job.metadata is None

    def test_render_job_with_all_fields(self) -> None:
        """Test creating a RenderJob with all fields."""
        job = RenderJob(
            job_id="xyz-789",
            status=RenderStatus.COMPLETED,
            artifact_url="https://example.com/video.mp4",
            error=None,
            metadata={"duration": 30, "size_bytes": 1024000},
        )

        assert job.job_id == "xyz-789"
        assert job.status == RenderStatus.COMPLETED
        assert job.artifact_url == "https://example.com/video.mp4"
        assert job.metadata == {"duration": 30, "size_bytes": 1024000}

    def test_render_job_failed_with_error(self) -> None:
        """Test creating a failed RenderJob with error message."""
        job = RenderJob(
            job_id="fail-001",
            status=RenderStatus.FAILED,
            error="Composition not found: invalid_comp",
        )

        assert job.status == RenderStatus.FAILED
        assert job.error == "Composition not found: invalid_comp"
        assert job.artifact_url is None


class TestRenderProviderProtocol:
    """Tests for the RenderProvider Protocol."""

    def test_protocol_can_be_implemented(self) -> None:
        """Test that a class can implement the RenderProvider Protocol."""

        class MockRenderProvider:
            """Mock implementation of RenderProvider."""

            async def render(
                self,
                composition: str,
                props: dict[str, Any],
                webhook_url: str | None = None,
            ) -> RenderJob:
                return RenderJob(
                    job_id=f"mock-{composition}",
                    status=RenderStatus.PENDING,
                    metadata={"composition": composition},
                )

            async def get_status(self, job_id: str) -> RenderJob:
                return RenderJob(
                    job_id=job_id,
                    status=RenderStatus.COMPLETED,
                    artifact_url="https://mock.example.com/video.mp4",
                )

        # Type check: this should satisfy the Protocol
        provider: RenderProvider = MockRenderProvider()
        assert provider is not None

    @pytest.mark.asyncio
    async def test_mock_provider_render(self) -> None:
        """Test mock provider render method."""

        class MockRenderProvider:
            async def render(
                self,
                composition: str,
                props: dict[str, Any],
                webhook_url: str | None = None,
            ) -> RenderJob:
                return RenderJob(
                    job_id="test-job-123",
                    status=RenderStatus.PENDING,
                )

            async def get_status(self, job_id: str) -> RenderJob:
                return RenderJob(job_id=job_id, status=RenderStatus.COMPLETED)

        provider = MockRenderProvider()
        job = await provider.render("test_comp", {"title": "Test"})

        assert job.job_id == "test-job-123"
        assert job.status == RenderStatus.PENDING

    @pytest.mark.asyncio
    async def test_mock_provider_get_status(self) -> None:
        """Test mock provider get_status method."""

        class MockRenderProvider:
            async def render(
                self,
                composition: str,
                props: dict[str, Any],
                webhook_url: str | None = None,
            ) -> RenderJob:
                return RenderJob(job_id="job-1", status=RenderStatus.PENDING)

            async def get_status(self, job_id: str) -> RenderJob:
                return RenderJob(
                    job_id=job_id,
                    status=RenderStatus.COMPLETED,
                    artifact_url="https://rendered.example.com/out.mp4",
                )

        provider = MockRenderProvider()
        status = await provider.get_status("job-1")

        assert status.status == RenderStatus.COMPLETED
        assert status.artifact_url == "https://rendered.example.com/out.mp4"


class TestGetRenderProvider:
    """Tests for the get_render_provider factory function."""

    def test_factory_returns_local_remotion_provider(self) -> None:
        """Test that get_render_provider returns LocalRemotionProvider by default."""
        from myloware.services.render_local import LocalRemotionProvider
        from myloware.services.render_provider import get_render_provider

        # Story 2.2 implemented LocalRemotionProvider
        provider = get_render_provider()

        assert isinstance(provider, LocalRemotionProvider)
        # Verify it implements the RenderProvider protocol methods
        assert hasattr(provider, "render")
        assert hasattr(provider, "get_status")

    def test_factory_raises_for_unknown_provider(self, monkeypatch) -> None:
        from myloware.services.render_provider import get_render_provider
        from myloware.config.settings import settings

        monkeypatch.setattr(settings, "render_provider", "nope")

        with pytest.raises(ValueError, match="Unknown render provider"):
            get_render_provider()
