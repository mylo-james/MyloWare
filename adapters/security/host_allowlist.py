"""Common helpers for outbound host allowlists."""
from __future__ import annotations

from typing import Collection, Iterable

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_TEST_SUFFIXES = (".test", ".example")


def _normalize_hosts(hosts: Iterable[str]) -> set[str]:
    return {host.lower() for host in hosts if host}


def is_allowed_host(host: str, allowed_hosts: Collection[str], *, allow_dev_hosts: bool = True) -> bool:
    """Return True when host matches allowlist or is an accepted local/test host."""

    if not host:
        return True
    host = host.lower()
    if allow_dev_hosts:
        if host in _LOCAL_HOSTS or host.endswith(".localhost"):
            return True
        if any(host.endswith(suffix) for suffix in _TEST_SUFFIXES):
            return True
    return host in _normalize_hosts(allowed_hosts)


def ensure_host_allowed(
    host: str,
    allowed_hosts: Collection[str],
    *,
    component: str,
    allow_dev_hosts: bool = True,
) -> None:
    if not is_allowed_host(host, allowed_hosts, allow_dev_hosts=allow_dev_hosts):
        allowed_display = ", ".join(sorted(_normalize_hosts(allowed_hosts))) or "<none>"
        raise ValueError(f"{component} disallows host '{host}'. Allowed hosts: {allowed_display}")
