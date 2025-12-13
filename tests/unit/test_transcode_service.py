"""Tests for the TranscodeService."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest

from services.transcode import TranscodeResult, TranscodeService, transcode_video


class TestTranscodeResult:
    """Tests for TranscodeResult dataclass."""

    def test_ok_result(self):
        """Test successful result creation."""
        result = TranscodeResult.ok("https://example.com/video.mp4", Path("/tmp/video.mp4"))

        assert result.success is True
        assert result.output_url == "https://example.com/video.mp4"
        assert result.output_path == Path("/tmp/video.mp4")
        assert result.error is None

    def test_failed_result(self):
        """Test failed result creation."""
        result = TranscodeResult.failed("Download timeout")

        assert result.success is False
        assert result.output_url is None
        assert result.output_path is None
        assert result.error == "Download timeout"


class TestTranscodeService:
    """Tests for TranscodeService."""

    def test_init_creates_output_dir(self, tmp_path):
        """Service should create output directory on init."""
        output_dir = tmp_path / "transcode_output"
        assert not output_dir.exists()

        service = TranscodeService(output_dir=str(output_dir))

        assert output_dir.exists()
        assert service.output_dir == output_dir

    @pytest.mark.asyncio
    async def test_transcode_download_failure(self):
        """Transcode should return failure when download fails."""
        service = TranscodeService()

        with patch.object(service, "_download_video", return_value=None):
            result = await service.transcode(
                "https://example.com/video.mp4",
                UUID("00000000-0000-0000-0000-000000000001"),
                video_index=0,
            )

        assert result.success is False
        assert "download" in result.error.lower()

    @pytest.mark.asyncio
    async def test_transcode_ffmpeg_failure(self, tmp_path):
        """Transcode should return failure when both ffmpeg methods fail."""
        service = TranscodeService(output_dir=str(tmp_path))

        with (
            patch.object(service, "_download_video", return_value=tmp_path / "input.mp4"),
            patch.object(service, "_transcode_with_local_ffmpeg", return_value=False),
            patch.object(service, "_transcode_with_docker_ffmpeg", return_value=False),
            patch.object(service, "_cleanup_file"),
        ):
            result = await service.transcode(
                "https://example.com/video.mp4",
                UUID("00000000-0000-0000-0000-000000000001"),
                video_index=0,
            )

        assert result.success is False
        assert "failed" in result.error.lower()

    @pytest.mark.asyncio
    async def test_transcode_success_with_local_ffmpeg(self, tmp_path):
        """Transcode should succeed with local ffmpeg."""
        service = TranscodeService(output_dir=str(tmp_path))
        run_id = UUID("00000000-0000-0000-0000-000000000002")

        with (
            patch.object(service, "_download_video", return_value=tmp_path / "input.mp4"),
            patch.object(service, "_transcode_with_local_ffmpeg", return_value=True),
            patch.object(service, "_cleanup_file"),
            patch("services.transcode.settings") as mock_settings,
        ):
            mock_settings.webhook_base_url = "https://api.example.com"
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False

            result = await service.transcode(
                "https://source.com/video.mp4",
                run_id,
                video_index=3,
            )

        assert result.success is True
        assert f"sora_{run_id}_3.mp4" in result.output_url
        assert "api.example.com" in result.output_url

    @pytest.mark.asyncio
    async def test_transcode_falls_back_to_docker(self, tmp_path):
        """Transcode should fall back to Docker when local ffmpeg fails."""
        service = TranscodeService(output_dir=str(tmp_path))

        with (
            patch.object(service, "_download_video", return_value=tmp_path / "input.mp4"),
            patch.object(service, "_transcode_with_local_ffmpeg", return_value=False),
            patch.object(service, "_transcode_with_docker_ffmpeg", return_value=True),
            patch.object(service, "_cleanup_file"),
            patch("services.transcode.settings") as mock_settings,
        ):
            mock_settings.webhook_base_url = "https://example.com"
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False

            result = await service.transcode(
                "https://source.com/video.mp4",
                UUID("00000000-0000-0000-0000-000000000003"),
                video_index=0,
            )

        assert result.success is True

    def test_transcode_with_local_ffmpeg_shell_false(self, tmp_path):
        """Local ffmpeg should use shell=False for security."""
        service = TranscodeService(output_dir=str(tmp_path))

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)

            service._transcode_with_local_ffmpeg(
                tmp_path / "input.mp4",
                tmp_path / "output.mp4",
            )

            # Verify shell=False is explicitly set
            mock_run.assert_called_once()
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs.get("shell") is False

    def test_transcode_with_docker_ffmpeg_shell_false(self, tmp_path):
        """Docker ffmpeg should use shell=False for security."""
        service = TranscodeService(output_dir=str(tmp_path))

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)

            service._transcode_with_docker_ffmpeg(
                tmp_path / "input.mp4",
                tmp_path / "output.mp4",
            )

            # Verify shell=False is explicitly set
            mock_run.assert_called_once()
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs.get("shell") is False


class TestTranscodeVideoConvenienceFunction:
    """Tests for the transcode_video convenience function."""

    @pytest.mark.asyncio
    async def test_returns_url_on_success(self):
        """Should return URL string on success."""
        with patch("services.transcode.TranscodeService") as MockService:
            mock_instance = MockService.return_value
            mock_instance.transcode = AsyncMock(
                return_value=TranscodeResult.ok("https://result.com/v.mp4", Path("/tmp/v.mp4"))
            )

            result = await transcode_video(
                "https://source.com/video.mp4",
                UUID("00000000-0000-0000-0000-000000000001"),
                video_index=0,
            )

            assert result == "https://result.com/v.mp4"

    @pytest.mark.asyncio
    async def test_returns_none_on_failure(self):
        """Should return None on failure."""
        with patch("services.transcode.TranscodeService") as MockService:
            mock_instance = MockService.return_value
            mock_instance.transcode = AsyncMock(
                return_value=TranscodeResult.failed("Network error")
            )

            result = await transcode_video(
                "https://source.com/video.mp4",
                UUID("00000000-0000-0000-0000-000000000001"),
                video_index=0,
            )

            assert result is None
