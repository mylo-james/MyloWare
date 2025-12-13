"""Video transcoding service for OpenAI Sora video compatibility.

OpenAI Sora videos often use codecs that Chromium/Remotion cannot decode.
This service handles downloading and transcoding to H.264/AAC format.
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from uuid import UUID
from urllib.parse import urlparse
import ipaddress
import asyncio
import socket

import httpx

from config.settings import settings
from observability.logging import get_logger

logger = get_logger(__name__)


@dataclass
class TranscodeResult:
    """Result of a transcode operation."""

    success: bool
    output_url: Optional[str] = None
    output_path: Optional[Path] = None
    error: Optional[str] = None

    @classmethod
    def ok(cls, url: str, path: Path) -> "TranscodeResult":
        return cls(success=True, output_url=url, output_path=path)

    @classmethod
    def failed(cls, error: str) -> "TranscodeResult":
        return cls(success=False, error=error)


class TranscodeService:
    """Service for transcoding videos to Remotion-compatible format.

    Handles:
    - Downloading source videos from URLs
    - Transcoding to H.264/AAC using ffmpeg (local or Docker)
    - Serving transcoded videos via the media endpoint

    Usage:
        service = TranscodeService()
        result = await service.transcode(source_url, run_id, video_index)
        if result.success:
            print(f"Video available at: {result.output_url}")
    """

    DEFAULT_OUTPUT_DIR = "/tmp/myloware_videos"
    DOWNLOAD_TIMEOUT = 120.0
    TRANSCODE_TIMEOUT = 300

    def __init__(self, output_dir: Optional[str] = None):
        """Initialize the transcode service.

        Args:
            output_dir: Directory to store transcoded videos. Defaults to /tmp/myloware_videos.
        """
        self.output_dir = Path(output_dir or self.DEFAULT_OUTPUT_DIR)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._semaphore = asyncio.Semaphore(max(1, settings.transcode_max_concurrency))

    async def transcode(
        self,
        source_url: str,
        run_id: UUID,
        video_index: int,
    ) -> TranscodeResult:
        """Download and transcode a video to Remotion-compatible format.

        Args:
            source_url: URL of the source video to download
            run_id: Run ID for naming the output file
            video_index: Index of the video within the run

        Returns:
            TranscodeResult with success status and output URL/path
        """
        # Basic SSRF/host validation. Allow file:// for local poller downloads.
        parsed = urlparse(source_url)
        if parsed.scheme not in {"http", "https", "file"}:
            return TranscodeResult.failed("Unsupported URL scheme for transcode")
        input_path = None

        if parsed.scheme == "file":
            input_path = Path(parsed.path)
            if not input_path.exists():
                return TranscodeResult.failed("Local file not found for transcode")
        else:
            hostname = parsed.hostname or ""
            if "localhost" in hostname or hostname in {"127.0.0.1"}:
                return TranscodeResult.failed("Localhost URLs are not allowed for transcode")
            try:
                ip_obj = ipaddress.ip_address(hostname)
                if ip_obj.is_private and not settings.transcode_allow_private:
                    return TranscodeResult.failed("Private network URLs are blocked for transcode")
            except ValueError:
                # hostname is not an IP; allow unless allowlist is set
                if settings.transcode_allowed_domains:
                    if not any(hostname.endswith(d) for d in settings.transcode_allowed_domains):
                        return TranscodeResult.failed("Domain not allowed for transcode")

            # Download source video
            input_path = await self._download_video(source_url)
            if input_path is None:
                return TranscodeResult.failed("Failed to download source video")

        output_filename = f"sora_{run_id}_{video_index}.mp4"
        output_path = self.output_dir / output_filename

        async with self._semaphore:
            try:
                # Try local ffmpeg first
                success = self._transcode_with_local_ffmpeg(input_path, output_path)

                if not success:
                    # Fall back to Docker ffmpeg
                    logger.info("Local ffmpeg failed, trying Docker...")
                    success = self._transcode_with_docker_ffmpeg(input_path, output_path)

                if not success:
                    return TranscodeResult.failed(
                        "Transcode failed with both local and Docker ffmpeg"
                    )

                # Build public URL for the transcoded video
                public_url = f"{settings.webhook_base_url}/v1/media/transcoded/{output_filename}"
                logger.info("Transcoded video available at: %s", public_url)

                return TranscodeResult.ok(public_url, output_path)

            except subprocess.TimeoutExpired:
                return TranscodeResult.failed(
                    f"Transcode timed out after {self.TRANSCODE_TIMEOUT}s"
                )
            except Exception as e:
                logger.exception("Transcode error: %s", e)
                return TranscodeResult.failed(str(e))
            finally:
                # Clean up downloaded input file
                self._cleanup_file(input_path)
                # Best-effort GC for old outputs
                await asyncio.to_thread(self.cleanup_old_outputs, 24 * 60 * 60)

    async def _download_video(self, url: str) -> Optional[Path]:
        """Download a video from URL to a temporary file.

        Args:
            url: URL to download from

        Returns:
            Path to the downloaded file, or None if download failed
        """
        logger.info("Downloading video for transcode: %s", url[:60])

        try:
            # DNS rebinding / SSRF hardening: resolve hostname and reject non-global IPs unless allowlisted.
            parsed = urlparse(url)
            hostname = parsed.hostname or ""
            if not hostname:
                logger.error("Download failed: missing hostname in URL")
                return None

            # Enforce optional hostname allowlist (suffix match) before any network calls.
            if settings.transcode_allowed_domains:
                allowed = any(hostname.endswith(d) for d in settings.transcode_allowed_domains)
                if not allowed:
                    logger.warning("Download blocked: hostname not in allowlist: %s", hostname)
                    return None

            # Resolve host -> IPs and block private/reserved targets unless explicitly allowed.
            if not settings.transcode_allow_private:
                resolved_ips: set[str] = set()
                try:
                    ip_obj = ipaddress.ip_address(hostname)
                    resolved_ips = {str(ip_obj)}
                except ValueError:
                    try:
                        infos = await asyncio.get_running_loop().getaddrinfo(
                            hostname,
                            None,
                            type=socket.SOCK_STREAM,
                        )
                        resolved_ips = {info[4][0] for info in infos if info and info[4]}
                    except socket.gaierror as exc:
                        logger.error("Download blocked: DNS resolution failed for %s: %s", hostname, exc)
                        return None

                if not resolved_ips:
                    logger.error("Download blocked: no IPs resolved for %s", hostname)
                    return None

                blocked = []
                for ip_str in resolved_ips:
                    try:
                        ip_target = ipaddress.ip_address(ip_str)
                    except ValueError:
                        continue
                    if not ip_target.is_global:
                        blocked.append(ip_str)

                if blocked:
                    logger.warning(
                        "Download blocked: hostname resolves to non-public IPs: %s -> %s",
                        hostname,
                        ",".join(sorted(blocked)),
                    )
                    return None

            async with httpx.AsyncClient(timeout=self.DOWNLOAD_TIMEOUT) as client:
                response = await client.get(url)
                response.raise_for_status()

                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                    tmp.write(response.content)
                    return Path(tmp.name)

        except httpx.HTTPStatusError as e:
            logger.error("Download failed with status %d: %s", e.response.status_code, url)
            return None
        except httpx.TimeoutException:
            logger.error("Download timed out: %s", url)
            return None
        except Exception as e:
            logger.error("Download error: %s", e)
            return None

    def _transcode_with_local_ffmpeg(self, input_path: Path, output_path: Path) -> bool:
        """Transcode using locally installed ffmpeg.

        Args:
            input_path: Path to input video file
            output_path: Path for output video file

        Returns:
            True if transcode succeeded, False otherwise
        """
        logger.info("Transcoding video to H.264/AAC with local ffmpeg...")

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(output_path),
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=self.TRANSCODE_TIMEOUT,
            shell=False,  # Security: explicitly disable shell
        )

        if result.returncode != 0:
            logger.warning("Local ffmpeg failed: %s", result.stderr.decode()[:200])
            return False

        return True

    def _transcode_with_docker_ffmpeg(self, input_path: Path, output_path: Path) -> bool:
        """Transcode using ffmpeg in Docker container.

        Args:
            input_path: Path to input video file
            output_path: Path for output video file

        Returns:
            True if transcode succeeded, False otherwise
        """
        logger.info("Transcoding video to H.264/AAC with Docker ffmpeg...")

        input_dir = input_path.parent
        output_dir = output_path.parent

        cmd = [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{input_dir}:/input",
            "-v",
            f"{output_dir}:/output",
            "linuxserver/ffmpeg",
            "-y",
            "-i",
            f"/input/{input_path.name}",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            f"/output/{output_path.name}",
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=self.TRANSCODE_TIMEOUT,
            shell=False,  # Security: explicitly disable shell
        )

        if result.returncode != 0:
            logger.error("Docker ffmpeg failed: %s", result.stderr.decode()[:200])
            return False

        return True

    def cleanup_old_outputs(self, max_age_seconds: int = 86400) -> None:
        """Delete transcoded output files older than max_age_seconds."""
        try:
            for path in self.output_dir.glob("*.mp4"):
                try:
                    age = path.stat().st_mtime
                except OSError:
                    continue
                if age and (time.time() - age) > max_age_seconds:
                    path.unlink(missing_ok=True)
        except Exception as exc:
            logger.debug("Cleanup of old outputs failed: %s", exc)

    def _cleanup_file(self, path: Optional[Path]) -> None:
        """Safely delete a temporary file."""
        if path and path.exists():
            try:
                path.unlink()
            except OSError as e:
                logger.warning("Failed to cleanup temp file %s: %s", path, e)


# Module-level convenience function for backward compatibility
async def transcode_video(source_url: str, run_id: UUID, video_index: int) -> str | None:
    """Convenience function wrapping TranscodeService.

    Returns the transcoded video URL or None if failed.
    """
    service = TranscodeService()
    result = await service.transcode(source_url, run_id, video_index)
    return result.output_url if result.success else None


__all__ = ["TranscodeService", "TranscodeResult", "transcode_video"]
