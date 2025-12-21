"""Video transcoding service for OpenAI Sora video compatibility.

OpenAI Sora videos often use codecs that Chromium/Remotion cannot decode.
This service handles downloading and transcoding to H.264/AAC format.
"""

from __future__ import annotations

import re
import subprocess  # nosec B404
import shutil
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

from myloware.config.provider_modes import effective_sora_provider
from myloware.config.settings import settings
from myloware.observability.logging import get_logger
from myloware.services.fake_sora import resolve_fake_sora_clip

logger = get_logger(__name__)


def _hostname_in_allowlist(hostname: str, allowed_domains: list[str]) -> bool:
    """Return True if hostname matches an allowed domain exactly or as a subdomain.

    Avoids bypasses like allowing "example.com" and matching "badexample.com".
    """
    host = (hostname or "").strip().lower().rstrip(".")
    if not host:
        return False
    for raw in allowed_domains:
        dom = (raw or "").strip().lower().strip(".")
        if not dom:
            continue
        if host == dom or host.endswith(f".{dom}"):
            return True
    return False


_FAKE_SORA_MEDIA_PATH = re.compile(r"^/v1/media/sora/(?P<task_id>[^/]+)\.mp4$")
_LOCAL_HOSTNAMES = {"localhost", "127.0.0.1", "0.0.0.0", "testserver", "test"}  # nosec B104


def _fake_media_allowed_hostnames() -> set[str]:
    """Hostnames allowed for fake Sora media URL -> fixture resolution.

    In Docker, our own API is typically addressed by service name (e.g. "myloware"),
    not "localhost". When `SORA_PROVIDER=fake`, we treat the configured
    `WEBHOOK_BASE_URL` hostname as a local alias for the `/v1/media/sora/...` proxy.
    """
    allowed = set(_LOCAL_HOSTNAMES)
    base = str(getattr(settings, "webhook_base_url", "") or "").strip()
    if not base:
        return allowed
    try:
        parsed = urlparse(base)
    except Exception:
        return allowed
    host = (parsed.hostname or "").strip().lower()
    if host:
        allowed.add(host)
    return allowed


def _resolve_fake_sora_media_url_to_path(url: str) -> Path | None:
    """Resolve a fake Sora media URL back to a local fixture path.

    This is used to keep SSRF protections intact while still supporting
    contract-exact local runs where `resultUrls` point to our own API.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return None
    hostname = (parsed.hostname or "").strip().lower()
    if hostname not in _fake_media_allowed_hostnames():
        return None
    match = _FAKE_SORA_MEDIA_PATH.match(parsed.path or "")
    if not match:
        return None
    task_id = match.group("task_id")
    return resolve_fake_sora_clip(task_id)


def _safe_openai_tempfile_path(path: Path) -> bool:
    """Return True if `path` looks like a temp file created by our OpenAI download helper.

    In production we keep `transcode_allow_file_urls=False` to avoid exfiltrating arbitrary
    local files via `file://` URLs. However, OpenAI Standard Webhooks do not include
    signed download URLs for video assets; we download content to a temp file and then
    transcode it. This helper enables that specific internal path without relaxing
    transcode input safety globally.
    """
    try:
        resolved = path.resolve()
    except Exception:
        return False

    # Prevent symlink tricks: if the resolved path escapes the temp dir, reject.
    tmp_dir = Path(tempfile.gettempdir()).resolve()
    if resolved.parent != tmp_dir:
        return False

    name = resolved.name
    if not (name.startswith("openai_video_") and name.endswith(".mp4")):
        return False

    try:
        if not resolved.is_file():
            return False
    except OSError:
        return False

    return True


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

    DEFAULT_OUTPUT_DIR = str(Path(tempfile.gettempdir()) / "myloware_videos")
    DOWNLOAD_TIMEOUT = 120.0
    TRANSCODE_TIMEOUT = 300

    def __init__(self, output_dir: Optional[str] = None):
        """Initialize the transcode service.

        Args:
            output_dir: Directory to store transcoded videos. Defaults to a project subdir of the OS temp directory.
        """
        default_dir = getattr(settings, "transcode_output_dir", "") or self.DEFAULT_OUTPUT_DIR
        self.output_dir = Path(output_dir or default_dir)
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
        sora_mode = effective_sora_provider(settings)
        input_path = None
        cleanup_input = False
        passthrough_copy = False

        if parsed.scheme == "file":
            allow_file_urls = bool(getattr(settings, "transcode_allow_file_urls", False))
            input_path = Path(parsed.path)
            if not allow_file_urls and not _safe_openai_tempfile_path(input_path):
                return TranscodeResult.failed("file:// URLs are disabled for transcode")
            if not input_path.exists():
                return TranscodeResult.failed("Local file not found for transcode")
        else:
            # Fake Sora provider: allow our own local media proxy URLs by mapping them
            # back to fixture files (avoids relaxing SSRF restrictions for localhost).
            if sora_mode == "fake":
                fake_path = _resolve_fake_sora_media_url_to_path(source_url)
                if fake_path is not None:
                    if not fake_path.exists():
                        return TranscodeResult.failed("Fake Sora clip not found for transcode")
                    input_path = fake_path
                    cleanup_input = False
                    passthrough_copy = True
                else:
                    input_path = None

            if input_path is not None:
                # Resolved via fake provider mapping.
                pass
            else:
                hostname = parsed.hostname or ""
                if "localhost" in hostname or hostname in {"127.0.0.1"}:
                    return TranscodeResult.failed("Localhost URLs are not allowed for transcode")
                try:
                    ip_obj = ipaddress.ip_address(hostname)
                    if ip_obj.is_private and not settings.transcode_allow_private:
                        return TranscodeResult.failed(
                            "Private network URLs are blocked for transcode"
                        )
                except ValueError:
                    # hostname is not an IP; allow unless allowlist is set
                    if settings.transcode_allowed_domains:
                        if not _hostname_in_allowlist(hostname, settings.transcode_allowed_domains):
                            return TranscodeResult.failed("Domain not allowed for transcode")

                # Download source video
                input_path = await self._download_video(source_url)
                if input_path is None:
                    return TranscodeResult.failed("Failed to download source video")
                cleanup_input = True

        output_filename = f"sora_{run_id}_{video_index}.mp4"
        output_path = self.output_dir / output_filename

        async with self._semaphore:
            try:
                if passthrough_copy:
                    # Fake provider: fixtures should already be Remotion-compatible.
                    # Write a deterministic output file without requiring ffmpeg.
                    try:
                        if input_path.resolve() != output_path.resolve():
                            shutil.copyfile(input_path, output_path)
                        else:
                            # Input already matches output path; ensure file exists.
                            if not output_path.exists():
                                return TranscodeResult.failed(
                                    "Fake transcode failed: output file missing"
                                )
                    except Exception as exc:
                        logger.exception("Fake transcode copy failed: %s", exc)
                        return TranscodeResult.failed("Fake transcode copy failed")
                else:
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

                backend = getattr(settings, "transcode_storage_backend", "local")
                if backend == "s3":
                    from myloware.storage.object_store import get_s3_store

                    bucket = settings.transcode_s3_bucket
                    prefix = (settings.transcode_s3_prefix or "").strip("/")
                    key = f"{prefix}/{output_filename}" if prefix else output_filename

                    uri = await get_s3_store().upload_file_async(
                        bucket=bucket,
                        key=key,
                        path=output_path,
                        content_type="video/mp4",
                    )
                    logger.info("Transcoded video uploaded to object storage: %s", uri)
                    return TranscodeResult.ok(uri, output_path)

                base_url = str(getattr(settings, "webhook_base_url", "") or "").rstrip("/")
                public_url = (
                    f"{base_url}/v1/media/transcoded/{output_filename}"
                    if base_url
                    else f"/v1/media/transcoded/{output_filename}"
                )
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
                # Clean up downloaded input file (never delete user-provided file:// paths)
                if cleanup_input:
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
                allowed = _hostname_in_allowlist(hostname, settings.transcode_allowed_domains)
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
                        logger.error(
                            "Download blocked: DNS resolution failed for %s: %s", hostname, exc
                        )
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

        ffmpeg_bin = shutil.which("ffmpeg")
        if not ffmpeg_bin:
            logger.info("Local ffmpeg not found on PATH; skipping local transcode.")
            return False

        cmd = [
            ffmpeg_bin,
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

        result = subprocess.run(  # nosec B603
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

        docker_bin = shutil.which("docker")
        if not docker_bin:
            logger.info("Docker not found on PATH; skipping docker transcode.")
            return False

        input_dir = input_path.parent
        output_dir = output_path.parent

        cmd = [
            docker_bin,
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

        result = subprocess.run(  # nosec B603
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
