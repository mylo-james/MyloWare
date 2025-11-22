"""Pytest fixtures for the python_orchestrator integration suite."""
from __future__ import annotations

import socket
from typing import Iterable

import pytest

_ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}
_ALLOWED_PREFIXES: tuple[str, ...] = ("127.", "0.0.0.0")


def _is_allowed_host(host: str | bytes | None) -> bool:
    if host is None:
        return False
    if isinstance(host, bytes):
        try:
            host = host.decode("utf-8")
        except UnicodeDecodeError:
            return False
    host = host.strip()
    if host in _ALLOWED_HOSTS:
        return True
    return any(host.startswith(prefix) for prefix in _ALLOWED_PREFIXES)


@pytest.fixture(autouse=True)
def block_external_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Disable outbound network calls for mocked E2E tests."""

    real_create_connection = socket.create_connection

    def guarded_create_connection(address: tuple[str, int] | Iterable[str], *args, **kwargs):
        host = address[0] if isinstance(address, tuple) else next(iter(address), None)
        if not _is_allowed_host(host):
            raise RuntimeError(f"Network access to '{host}' disabled in mocked E2E tests")
        return real_create_connection(address, *args, **kwargs)

    monkeypatch.setattr(socket, "create_connection", guarded_create_connection)
