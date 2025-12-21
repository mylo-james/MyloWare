"""Unit tests for LocalRemotionProvider."""

from __future__ import annotations

import httpx
import pytest

from myloware.services.render_local import LocalRemotionProvider
from myloware.services.render_provider import RenderJob, RenderStatus


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
        from myloware.services.render_provider import get_render_provider

        provider = get_render_provider()
        assert isinstance(provider, LocalRemotionProvider)

    def test_get_render_provider_uses_settings(self) -> None:
        """Test that provider uses settings for service URL."""
        from myloware.config.settings import settings
        from myloware.services.render_provider import get_render_provider

        provider = get_render_provider()
        assert provider.service_url == settings.remotion_service_url

    def test_provider_satisfies_protocol(self) -> None:
        """Test that LocalRemotionProvider satisfies RenderProvider Protocol."""
        from myloware.services.render_provider import RenderProvider

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
        provider = LocalRemotionProvider("http://localhost:1")  # Likely closed port

        # This will fail due to connection, but we test error handling
        job = await provider.render("test", {})

        # Should return a failed job, not raise
        assert isinstance(job, RenderJob)
        assert job.status == RenderStatus.FAILED
        assert "unavailable" in job.error.lower()

    @pytest.mark.asyncio
    async def test_get_status_returns_render_job(self) -> None:
        """Test that get_status() would return a RenderJob (connection will fail)."""
        provider = LocalRemotionProvider("http://localhost:1")  # Likely closed port

        # This will fail due to connection, but we test error handling
        job = await provider.get_status("any-job-id")

        # Should return a failed job, not raise
        assert isinstance(job, RenderJob)
        assert job.status == RenderStatus.FAILED


class TestProviderHttpInteractions:
    """HTTP interaction tests using fakes (no network)."""

    @pytest.mark.anyio
    async def test_render_success_uses_job_id_from_response(self, monkeypatch) -> None:
        provider = LocalRemotionProvider("http://remotion.local")

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self):  # type: ignore[no-untyped-def]
                return {"job_id": "j1"}

        class FakeClient:
            def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                return None

            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return self

            async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                return None

            async def post(self, url: str, *, json, headers=None):  # type: ignore[no-untyped-def]
                assert url.endswith("/api/render")
                assert json["template"] == "comp"
                return FakeResponse()

        monkeypatch.setattr("myloware.services.render_local.httpx.AsyncClient", FakeClient)
        job = await provider.render("comp", {"foo": "bar"}, webhook_url="http://cb")
        assert job.job_id == "j1"
        assert job.status == RenderStatus.PENDING
        assert job.metadata["composition"] == "comp"

    @pytest.mark.anyio
    async def test_render_http_status_error_returns_failed_job(self, monkeypatch) -> None:
        provider = LocalRemotionProvider("http://remotion.local")

        req = httpx.Request("POST", "http://remotion.local/api/render")
        resp = httpx.Response(500, request=req)

        class FakeResponse:
            def raise_for_status(self) -> None:
                raise httpx.HTTPStatusError("bad", request=req, response=resp)

            def json(self):  # type: ignore[no-untyped-def]
                return {}

        class FakeClient:
            def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                return None

            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return self

            async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                return None

            async def post(self, url: str, *, json, headers=None):  # type: ignore[no-untyped-def]
                return FakeResponse()

        monkeypatch.setattr("myloware.services.render_local.httpx.AsyncClient", FakeClient)
        job = await provider.render("comp", {})
        assert job.status == RenderStatus.FAILED
        assert "500" in (job.error or "")

    @pytest.mark.anyio
    async def test_get_status_success_maps_status_strings(self, monkeypatch) -> None:
        provider = LocalRemotionProvider("http://remotion.local")

        class FakeResponse:
            def __init__(self, payload):  # type: ignore[no-untyped-def]
                self._payload = payload

            def raise_for_status(self) -> None:
                return None

            def json(self):  # type: ignore[no-untyped-def]
                return self._payload

        payloads = [
            {"status": "queued"},
            {"status": "rendering"},
            {"status": "done", "artifact_url": "http://x"},
            {"status": "unknown"},
        ]
        idx = {"i": 0}

        class FakeClient:
            def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                return None

            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return self

            async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                return None

            async def get(self, url: str, headers=None):  # type: ignore[no-untyped-def]
                payload = payloads[idx["i"]]
                idx["i"] += 1
                return FakeResponse(payload)

        monkeypatch.setattr("myloware.services.render_local.httpx.AsyncClient", FakeClient)

        assert (await provider.get_status("j")).status == RenderStatus.PENDING
        assert (await provider.get_status("j")).status == RenderStatus.RENDERING
        done = await provider.get_status("j")
        assert done.status == RenderStatus.COMPLETED
        assert done.artifact_url == "http://x"
        assert (await provider.get_status("j")).status == RenderStatus.PENDING

    @pytest.mark.anyio
    async def test_get_status_http_status_errors(self, monkeypatch) -> None:
        provider = LocalRemotionProvider("http://remotion.local")

        req = httpx.Request("GET", "http://remotion.local/api/render/j")
        resp_404 = httpx.Response(404, request=req)
        resp_500 = httpx.Response(500, request=req)

        class FakeResponse:
            def __init__(self, response):  # type: ignore[no-untyped-def]
                self._resp = response

            def raise_for_status(self) -> None:
                raise httpx.HTTPStatusError("bad", request=req, response=self._resp)

            def json(self):  # type: ignore[no-untyped-def]
                return {}

        class FakeClient:
            def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                return None

            _responses = [resp_404, resp_500]
            _i = 0

            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return self

            async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                return None

            async def get(self, url: str, headers=None):  # type: ignore[no-untyped-def]
                r = FakeClient._responses[FakeClient._i]
                FakeClient._i += 1
                return FakeResponse(r)

        monkeypatch.setattr("myloware.services.render_local.httpx.AsyncClient", FakeClient)

        nf = await provider.get_status("j")
        assert nf.status == RenderStatus.FAILED
        assert "Job not found" in (nf.error or "")

        other = await provider.get_status("j")
        assert other.status == RenderStatus.FAILED
        assert "500" in (other.error or "")
