"""FFmpeg normalization helper."""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Final

from urllib.parse import urlparse

import httpx

from adapters.security.host_allowlist import ensure_host_allowed

logger = logging.getLogger("myloware.content.editing.normalization.ffmpeg")

FFMPEG_ARGS: Final[list[str]] = [
    "ffmpeg",
    "-y",
    "-i",
    "{input}",
    "-vf",
    "scale=1920:1080,fps=30",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-filter:a",
    "loudnorm=I=-14:TP=-1.0:LRA=11",
    "-ar",
    "48000",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "{output}",
]


DEFAULT_FFMPEG_ALLOWED_HOSTS = [
    "mock.cdn.kie.ai",
    "mock.cdn.myloware.com",
    "mock.video.myloware.com",
    "cdn.myloware.com",
]


class FFmpegNormalizer:
    def __init__(self, *, allowed_hosts: list[str] | None = None, allow_dev_hosts: bool = True) -> None:
        self._http = httpx.Client(timeout=60)
        self._allowed_hosts = allowed_hosts or DEFAULT_FFMPEG_ALLOWED_HOSTS
        self._allow_dev_hosts = allow_dev_hosts

    def normalize(self, source_url: str) -> Path:
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg binary is required for normalization")

        with tempfile.TemporaryDirectory() as tmpdir:
            source_path = Path(tmpdir) / "input.mp4"
            output_path = Path(tmpdir) / "normalized.mp4"
            self._ensure_allowed_source(source_url)
            logger.info("Downloading asset for normalization", extra={"url": source_url})
            with self._http.stream("GET", source_url) as response:
                response.raise_for_status()
                with source_path.open("wb") as f:
                    for chunk in response.iter_bytes():
                        f.write(chunk)

            logger.info("Running ffmpeg normalization", extra={"output": str(output_path)})
            cmd = [arg.format(input=str(source_path), output=str(output_path)) for arg in FFMPEG_ARGS]
            subprocess.run(cmd, check=True)
            fd, tmp_path = tempfile.mkstemp(suffix=".mp4")
            os.close(fd)
            final_path = Path(tmp_path)
            shutil.copy2(output_path, final_path)
            return final_path

    def close(self) -> None:
        self._http.close()

    def _ensure_allowed_source(self, url: str) -> None:
        host = urlparse(url).hostname or ""
        ensure_host_allowed(
            host,
            self._allowed_hosts,
            component="FFmpegNormalizer source",
            allow_dev_hosts=self._allow_dev_hosts,
        )
