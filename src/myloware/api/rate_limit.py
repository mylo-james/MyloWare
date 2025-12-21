"""Rate limit helpers."""

from fastapi import Request
from slowapi.util import get_remote_address


def key_api_key_or_ip(request: Request) -> str:
    """Extract rate limit key: X-API-Key > Authorization > X-Rate-Limit-Namespace > IP."""
    api_key = request.headers.get("X-API-Key")
    if api_key:
        return f"apikey:{api_key}"

    auth = request.headers.get("Authorization")
    if auth:
        return f"auth:{auth}"

    namespace = request.headers.get("X-Rate-Limit-Namespace")
    if namespace:
        return f"ns:{namespace}"

    return f"ip:{get_remote_address(request)}"
