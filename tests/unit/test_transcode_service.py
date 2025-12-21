"""Tests for the TranscodeService."""

import subprocess
import socket
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import pytest

from myloware.services.transcode import (
    TranscodeResult,
    TranscodeService,
    _hostname_in_allowlist,
    transcode_video,
)


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

    def test_hostname_in_allowlist_exact_and_subdomain(self) -> None:
        assert _hostname_in_allowlist("example.com", ["example.com"]) is True
        assert _hostname_in_allowlist("sub.example.com", ["example.com"]) is True
        assert _hostname_in_allowlist("badexample.com", ["example.com"]) is False
        assert _hostname_in_allowlist("", ["example.com"]) is False
        assert _hostname_in_allowlist("example.com", ["", "example.com"]) is True

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
    async def test_transcode_rejects_unsupported_schemes(self, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))
        result = await service.transcode(
            "ftp://example.com/video.mp4",
            UUID("00000000-0000-0000-0000-000000000010"),
            video_index=0,
        )
        assert result.success is False
        assert "unsupported" in (result.error or "").lower()

    @pytest.mark.asyncio
    async def test_transcode_rejects_missing_local_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "myloware.services.transcode.settings.transcode_allow_file_urls",
            True,
        )
        service = TranscodeService(output_dir=str(tmp_path))
        missing = tmp_path / "missing.mp4"
        result = await service.transcode(
            f"file://{missing}",
            UUID("00000000-0000-0000-0000-000000000011"),
            video_index=0,
        )
        assert result.success is False
        assert "not found" in (result.error or "").lower()

    @pytest.mark.asyncio
    async def test_transcode_allows_openai_tempfile_without_enabling_file_urls(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.setattr(
            "myloware.services.transcode.settings.transcode_allow_file_urls",
            False,
        )
        service = TranscodeService(output_dir=str(tmp_path))

        tmp = tempfile.NamedTemporaryFile(prefix="openai_video_", suffix=".mp4", delete=False)
        try:
            input_path = Path(tmp.name)
            tmp.write(b"video")
            tmp.close()

            def fake_local(in_path: Path, out_path: Path) -> bool:  # type: ignore[no-untyped-def]
                out_path.write_bytes(b"y")
                return True

            monkeypatch.setattr(service, "_transcode_with_local_ffmpeg", fake_local)

            result = await service.transcode(
                f"file://{input_path}",
                UUID("00000000-0000-0000-0000-000000000013"),
                video_index=0,
            )
            assert result.success is True
            assert result.output_url and "transcoded" in result.output_url
        finally:
            try:
                tmp.close()
            except Exception:
                pass
            Path(tmp.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_transcode_rejects_localhost_urls(self, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))
        result = await service.transcode(
            "https://localhost/video.mp4",
            UUID("00000000-0000-0000-0000-000000000012"),
            video_index=0,
        )
        assert result.success is False
        assert "localhost" in (result.error or "").lower()

    @pytest.mark.asyncio
    async def test_transcode_accepts_local_fake_sora_media_url_in_fake_mode(
        self, tmp_path, monkeypatch
    ):
        """Fake Sora uses localhost /v1/media/sora/... URLs; transcode should accept them safely."""
        run_id = UUID("00000000-0000-0000-0000-000000000099")
        input_path = tmp_path / "fixture.mp4"
        input_path.write_bytes(b"video-bytes")

        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.sora_provider = "fake"
            mock_settings.use_fake_providers = False
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False
            mock_settings.transcode_storage_backend = "local"
            mock_settings.transcode_max_concurrency = 1
            mock_settings.webhook_base_url = "https://api.example.com"

            service = TranscodeService(output_dir=str(tmp_path))

            monkeypatch.setattr(
                "myloware.services.transcode.resolve_fake_sora_clip",
                lambda _task_id: input_path,
            )

            with patch.object(
                service, "_download_video", side_effect=AssertionError("should not download")
            ):
                result = await service.transcode(
                    "http://localhost:8000/v1/media/sora/video_0.mp4",
                    run_id,
                    video_index=0,
                )

        assert result.success is True
        assert result.output_url and result.output_url.startswith(
            "https://api.example.com/v1/media/transcoded/"
        )
        assert result.output_path and result.output_path.exists()

    @pytest.mark.asyncio
    async def test_transcode_rejects_private_ip_when_not_allowed(self, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))
        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allow_private = False
            mock_settings.transcode_allowed_domains = []

            result = await service.transcode(
                "https://10.0.0.1/video.mp4",
                UUID("00000000-0000-0000-0000-000000000013"),
                video_index=0,
            )
        assert result.success is False
        assert "private" in (result.error or "").lower()

    @pytest.mark.asyncio
    async def test_transcode_enforces_domain_allowlist(self, tmp_path, monkeypatch):
        service = TranscodeService(output_dir=str(tmp_path))
        monkeypatch.setattr("myloware.services.transcode.settings.transcode_allow_private", False)
        monkeypatch.setattr(
            "myloware.services.transcode.settings.transcode_allowed_domains",
            ["allowed.com"],
        )

        result = await service.transcode(
            "https://blocked.com/video.mp4",
            UUID("00000000-0000-0000-0000-000000000014"),
            video_index=0,
        )
        assert result.success is False
        assert "allowed" in (result.error or "").lower()

    @pytest.mark.asyncio
    async def test_transcode_accepts_allowed_domain(self, tmp_path, monkeypatch):
        service = TranscodeService(output_dir=str(tmp_path))
        monkeypatch.setattr("myloware.services.transcode.settings.transcode_allow_private", False)
        monkeypatch.setattr(
            "myloware.services.transcode.settings.transcode_allowed_domains",
            ["allowed.com"],
        )
        monkeypatch.setattr("myloware.services.transcode.settings.webhook_base_url", "")

        input_path = tmp_path / "input.mp4"
        input_path.write_bytes(b"x")

        def fake_local(_in: Path, out_path: Path) -> bool:  # type: ignore[no-untyped-def]
            out_path.write_bytes(b"y")
            return True

        async def fake_download(_u: str):  # type: ignore[no-untyped-def]
            return input_path

        monkeypatch.setattr(service, "_download_video", fake_download)
        monkeypatch.setattr(service, "_transcode_with_local_ffmpeg", fake_local)

        result = await service.transcode(
            "https://allowed.com/video.mp4",
            UUID("00000000-0000-0000-0000-000000000015"),
            video_index=1,
        )
        assert result.success is True

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
            patch("myloware.services.transcode.settings") as mock_settings,
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
    async def test_transcode_success_without_webhook_base_url_returns_relative_path(self, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))
        run_id = UUID("00000000-0000-0000-0000-000000000020")
        input_path = tmp_path / "input.mp4"
        input_path.write_bytes(b"x")

        def fake_local(in_path: Path, out_path: Path) -> bool:  # type: ignore[no-untyped-def]
            out_path.write_bytes(b"y")
            return True

        with (
            patch.object(service, "_download_video", return_value=input_path),
            patch.object(service, "_transcode_with_local_ffmpeg", side_effect=fake_local),
            patch("myloware.services.transcode.settings") as mock_settings,
        ):
            mock_settings.webhook_base_url = ""
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False
            mock_settings.transcode_storage_backend = "local"

            result = await service.transcode("https://example.com/v.mp4", run_id, video_index=0)

        assert result.success is True
        assert result.output_url and result.output_url.startswith("/v1/media/transcoded/")

    @pytest.mark.asyncio
    async def test_transcode_falls_back_to_docker(self, tmp_path):
        """Transcode should fall back to Docker when local ffmpeg fails."""
        service = TranscodeService(output_dir=str(tmp_path))

        with (
            patch.object(service, "_download_video", return_value=tmp_path / "input.mp4"),
            patch.object(service, "_transcode_with_local_ffmpeg", return_value=False),
            patch.object(service, "_transcode_with_docker_ffmpeg", return_value=True),
            patch.object(service, "_cleanup_file"),
            patch("myloware.services.transcode.settings") as mock_settings,
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

    @pytest.mark.asyncio
    async def test_transcode_s3_backend_uploads_and_returns_uri(self, tmp_path, monkeypatch):
        service = TranscodeService(output_dir=str(tmp_path))
        run_id = UUID("00000000-0000-0000-0000-000000000021")
        input_path = tmp_path / "input.mp4"
        input_path.write_bytes(b"x")

        def fake_local(in_path: Path, out_path: Path) -> bool:  # type: ignore[no-untyped-def]
            out_path.write_bytes(b"y")
            return True

        uploader = AsyncMock(return_value="s3://bucket/key.mp4")
        monkeypatch.setattr(
            "myloware.storage.object_store.get_s3_store",
            lambda: SimpleNamespace(upload_file_async=uploader),
        )

        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_storage_backend = "s3"
            mock_settings.transcode_s3_bucket = "bucket"
            mock_settings.transcode_s3_prefix = "prefix"
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False

            monkeypatch.setattr(service, "_transcode_with_local_ffmpeg", fake_local)

            result = await service.transcode(
                f"file://{input_path}",
                run_id,
                video_index=1,
            )

        assert result.success is True
        assert result.output_url == "s3://bucket/key.mp4"
        assert uploader.await_count == 1

    @pytest.mark.asyncio
    async def test_transcode_allowlist_does_not_match_lookalike_domains(self, tmp_path):
        """Allowlist matching should not be bypassable by lookalike suffixes."""
        service = TranscodeService(output_dir=str(tmp_path))
        run_id = UUID("00000000-0000-0000-0000-000000000004")

        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allowed_domains = ["example.com"]
            mock_settings.transcode_allow_private = False

            result = await service.transcode(
                "https://badexample.com/video.mp4",
                run_id,
                video_index=0,
            )

        assert result.success is False
        assert "not allowed" in (result.error or "").lower()

    def test_transcode_with_local_ffmpeg_shell_false(self, tmp_path):
        """Local ffmpeg should use shell=False for security."""
        service = TranscodeService(output_dir=str(tmp_path))

        with (
            patch("myloware.services.transcode.shutil.which", return_value="/usr/bin/ffmpeg"),
            patch("subprocess.run") as mock_run,
        ):
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

        with (
            patch("myloware.services.transcode.shutil.which", return_value="/usr/bin/docker"),
            patch("subprocess.run") as mock_run,
        ):
            mock_run.return_value = MagicMock(returncode=0)

            service._transcode_with_docker_ffmpeg(
                tmp_path / "input.mp4",
                tmp_path / "output.mp4",
            )

            # Verify shell=False is explicitly set
            mock_run.assert_called_once()
            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs.get("shell") is False

    def test_transcode_ffmpeg_binaries_missing_returns_false(self, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))

        with patch("myloware.services.transcode.shutil.which", return_value=None):
            assert (
                service._transcode_with_local_ffmpeg(tmp_path / "in.mp4", tmp_path / "out.mp4")
                is False
            )

        with patch("myloware.services.transcode.shutil.which", return_value=None):
            assert (
                service._transcode_with_docker_ffmpeg(tmp_path / "in.mp4", tmp_path / "out.mp4")
                is False
            )

    def test_transcode_ffmpeg_failures_return_false(self, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))

        with (
            patch("myloware.services.transcode.shutil.which", return_value="/bin/ffmpeg"),
            patch("subprocess.run") as run,
        ):
            run.return_value = MagicMock(returncode=1, stderr=b"bad")
            assert (
                service._transcode_with_local_ffmpeg(tmp_path / "in.mp4", tmp_path / "out.mp4")
                is False
            )

        with (
            patch("myloware.services.transcode.shutil.which", return_value="/bin/docker"),
            patch("subprocess.run") as run,
        ):
            run.return_value = MagicMock(returncode=1, stderr=b"bad")
            assert (
                service._transcode_with_docker_ffmpeg(tmp_path / "in.mp4", tmp_path / "out.mp4")
                is False
            )

    def test_cleanup_and_cleanup_file_error_paths(self, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))

        class _FakeFile:
            def __init__(self, name: str, *, mtime: float | None, raise_stat: bool = False):
                self._name = name
                self._mtime = mtime
                self._raise_stat = raise_stat
                self.unlinked = False

            def stat(self):  # type: ignore[no-untyped-def]
                if self._raise_stat:
                    raise OSError("nope")
                return SimpleNamespace(st_mtime=self._mtime)

            def unlink(self, *, missing_ok: bool = False):  # type: ignore[no-untyped-def]
                self.unlinked = True

        fake_old = _FakeFile("old.mp4", mtime=1.0)
        fake_bad = _FakeFile("bad.mp4", mtime=1.0, raise_stat=True)

        service.output_dir = SimpleNamespace(glob=lambda _p: [fake_old, fake_bad])  # type: ignore[assignment]
        service.cleanup_old_outputs(max_age_seconds=-1)
        assert fake_old.unlinked is True
        assert fake_bad.unlinked is False

        class _FakePath:
            def exists(self) -> bool:
                return True

            def unlink(self):  # type: ignore[no-untyped-def]
                raise OSError("boom")

        service._cleanup_file(_FakePath())  # type: ignore[arg-type]

        # Outer exception path: unexpected errors are swallowed.
        service.output_dir = SimpleNamespace(  # type: ignore[assignment]
            glob=lambda _p: (_ for _ in ()).throw(RuntimeError("boom"))
        )
        service.cleanup_old_outputs()

    @pytest.mark.asyncio
    async def test_transcode_maps_timeout_and_generic_errors(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "myloware.services.transcode.settings.transcode_allow_file_urls",
            True,
        )
        service = TranscodeService(output_dir=str(tmp_path))
        run_id = UUID("00000000-0000-0000-0000-000000000031")
        input_path = tmp_path / "input.mp4"
        input_path.write_bytes(b"x")

        async def no_thread(*_a, **_kw):  # type: ignore[no-untyped-def]
            return None

        monkeypatch.setattr("myloware.services.transcode.asyncio.to_thread", no_thread)

        def raise_timeout(_in: Path, _out: Path) -> bool:
            raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=service.TRANSCODE_TIMEOUT)

        with patch.object(service, "_transcode_with_local_ffmpeg", side_effect=raise_timeout):
            result = await service.transcode(f"file://{input_path}", run_id, video_index=0)
        assert result.success is False
        assert "timed out" in (result.error or "").lower()

        def raise_generic(_in: Path, _out: Path) -> bool:
            raise RuntimeError("boom")

        with patch.object(service, "_transcode_with_local_ffmpeg", side_effect=raise_generic):
            result = await service.transcode(f"file://{input_path}", run_id, video_index=0)
        assert result.success is False
        assert "boom" in (result.error or "")

    @pytest.mark.asyncio
    async def test_download_video_ssrf_checks_and_success(self, monkeypatch, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))

        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False

            # Missing hostname
            assert await service._download_video("https:///nope") is None

            # DNS resolution failure
            class FakeLoop:
                async def getaddrinfo(self, *_a, **_k):  # type: ignore[no-untyped-def]
                    raise socket.gaierror("nope")

            monkeypatch.setattr(
                "myloware.services.transcode.asyncio.get_running_loop", lambda: FakeLoop()
            )
            assert await service._download_video("https://example.com/v.mp4") is None

            # Blocked non-global IP
            class LoopLocal:
                async def getaddrinfo(self, *_a, **_k):  # type: ignore[no-untyped-def]
                    return [(None, None, None, None, ("127.0.0.1", 0))]

            monkeypatch.setattr(
                "myloware.services.transcode.asyncio.get_running_loop", lambda: LoopLocal()
            )
            assert await service._download_video("https://example.com/v.mp4") is None

            # Success path: global IP + httpx client returns bytes.
            class LoopGlobal:
                async def getaddrinfo(self, *_a, **_k):  # type: ignore[no-untyped-def]
                    return [(None, None, None, None, ("93.184.216.34", 0))]

            monkeypatch.setattr(
                "myloware.services.transcode.asyncio.get_running_loop", lambda: LoopGlobal()
            )

            class FakeResponse:
                def __init__(self):
                    self.content = b"video"

                def raise_for_status(self) -> None:
                    return None

            class FakeClient:
                def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                    return None

                async def __aenter__(self):  # type: ignore[no-untyped-def]
                    return self

                async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                    return None

                async def get(self, url: str):  # type: ignore[no-untyped-def]
                    return FakeResponse()

            monkeypatch.setattr("myloware.services.transcode.httpx.AsyncClient", FakeClient)
            path = await service._download_video("https://example.com/v.mp4")
            assert path and path.exists()

    @pytest.mark.asyncio
    async def test_download_video_ip_hostname_path(self, monkeypatch, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))

        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False

            class FakeResponse:
                def __init__(self):
                    self.content = b"video"

                def raise_for_status(self) -> None:
                    return None

            class FakeClient:
                def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                    return None

                async def __aenter__(self):  # type: ignore[no-untyped-def]
                    return self

                async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                    return None

                async def get(self, url: str):  # type: ignore[no-untyped-def]
                    return FakeResponse()

            monkeypatch.setattr("myloware.services.transcode.httpx.AsyncClient", FakeClient)
            path = await service._download_video("https://93.184.216.34/v.mp4")
            assert path and path.exists()

    @pytest.mark.asyncio
    async def test_download_video_allowlist_blocks(self, monkeypatch, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))
        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allowed_domains = ["example.com"]
            mock_settings.transcode_allow_private = True

            assert await service._download_video("https://badexample.com/v.mp4") is None

    @pytest.mark.asyncio
    async def test_download_video_blocks_when_no_ips_resolve(self, monkeypatch, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))
        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False

            class LoopEmpty:
                async def getaddrinfo(self, *_a, **_k):  # type: ignore[no-untyped-def]
                    return []

            monkeypatch.setattr(
                "myloware.services.transcode.asyncio.get_running_loop", lambda: LoopEmpty()
            )
            assert await service._download_video("https://example.com/v.mp4") is None

    @pytest.mark.asyncio
    async def test_download_video_ignores_invalid_resolved_ip_strings(self, monkeypatch, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))
        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = False

            class LoopBadIP:
                async def getaddrinfo(self, *_a, **_k):  # type: ignore[no-untyped-def]
                    return [(None, None, None, None, ("not-an-ip", 0))]

            monkeypatch.setattr(
                "myloware.services.transcode.asyncio.get_running_loop", lambda: LoopBadIP()
            )

            class FakeResponse:
                def __init__(self):
                    self.content = b"video"

                def raise_for_status(self) -> None:
                    return None

            class FakeClient:
                def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                    return None

                async def __aenter__(self):  # type: ignore[no-untyped-def]
                    return self

                async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                    return None

                async def get(self, url: str):  # type: ignore[no-untyped-def]
                    return FakeResponse()

            monkeypatch.setattr("myloware.services.transcode.httpx.AsyncClient", FakeClient)
            path = await service._download_video("https://example.com/v.mp4")
            assert path and path.exists()

    @pytest.mark.asyncio
    async def test_download_video_http_errors(self, monkeypatch, tmp_path):
        service = TranscodeService(output_dir=str(tmp_path))

        with patch("myloware.services.transcode.settings") as mock_settings:
            mock_settings.transcode_allowed_domains = []
            mock_settings.transcode_allow_private = True  # skip DNS/IP checks for this test

            class FakeClient:
                def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
                    return None

                async def __aenter__(self):  # type: ignore[no-untyped-def]
                    return self

                async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                    return None

                async def get(self, url: str):  # type: ignore[no-untyped-def]
                    req = httpx.Request("GET", url)
                    resp = httpx.Response(403, request=req)
                    raise httpx.HTTPStatusError("bad", request=req, response=resp)

            monkeypatch.setattr("myloware.services.transcode.httpx.AsyncClient", FakeClient)
            assert await service._download_video("https://example.com/v.mp4") is None

            class FakeTimeoutClient(FakeClient):
                async def get(self, url: str):  # type: ignore[no-untyped-def]
                    raise httpx.TimeoutException("t")

            monkeypatch.setattr("myloware.services.transcode.httpx.AsyncClient", FakeTimeoutClient)
            assert await service._download_video("https://example.com/v.mp4") is None

            class FakeGenericClient(FakeClient):
                async def get(self, url: str):  # type: ignore[no-untyped-def]
                    raise RuntimeError("boom")

            monkeypatch.setattr("myloware.services.transcode.httpx.AsyncClient", FakeGenericClient)
            assert await service._download_video("https://example.com/v.mp4") is None


class TestTranscodeVideoConvenienceFunction:
    """Tests for the transcode_video convenience function."""

    @pytest.mark.asyncio
    async def test_returns_url_on_success(self):
        """Should return URL string on success."""
        with patch("myloware.services.transcode.TranscodeService") as MockService:
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
        with patch("myloware.services.transcode.TranscodeService") as MockService:
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
