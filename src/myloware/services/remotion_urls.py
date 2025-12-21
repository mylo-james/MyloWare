"""Helpers for normalizing Remotion output URLs."""

from __future__ import annotations

from urllib.parse import urlparse

from myloware.config import settings
from myloware.observability.logging import get_logger

logger = get_logger(__name__)


def normalize_remotion_output_url(output_url: str | None) -> str | None:
    """Rewrite internal Remotion URLs to the public media proxy.

    This allows external services (like Upload-Post) to access rendered videos
    when Remotion outputs are only reachable inside the Docker network.
    """
    if not output_url:
        return output_url

    public_base = (settings.webhook_base_url or "").rstrip("/")
    if not public_base:
        return output_url

    try:
        parsed = urlparse(output_url)
    except Exception:
        return output_url

    host = (parsed.hostname or "").lower()
    port = parsed.port

    # Rewrite internal Remotion hosts and the configured REMOTION_SERVICE_URL host.
    internal_hosts = {"localhost", "remotion", "remotion-service"}
    try:
        remotion_base = (getattr(settings, "remotion_service_url", "") or "").strip()
        if remotion_base:
            remotion_host = (urlparse(remotion_base).hostname or "").lower()
            if remotion_host:
                internal_hosts.add(remotion_host)
    except Exception as exc:
        # If parsing fails, fall back to the static allowlist.
        logger.debug("Failed to parse REMOTION_SERVICE_URL for normalization", error=str(exc))

    is_internal_host = host in internal_hosts
    is_internal_port = port == 3001 or port is None

    if not (is_internal_host and is_internal_port):
        return output_url

    path = parsed.path or ""
    video_id = path.rstrip("/").split("/")[-1]
    if video_id.endswith(".mp4"):
        video_id = video_id[:-4]

    if not video_id:
        return output_url

    public_url = f"{public_base}/v1/media/video/{video_id}"
    if public_url != output_url:
        logger.info(
            "Converted Remotion output URL to public proxy: %s -> %s", output_url, public_url
        )
    return public_url
