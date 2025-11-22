#!/usr/bin/env python3
"""Snapshot secrets from .env.real (1Password pipe) into a regular .env file.

This script makes it possible to `source` the resulting .env and to build Docker
images without depending on the named pipe that 1Password creates on macOS.
"""
from __future__ import annotations

import argparse
import os
import stat
import sys
from pathlib import Path
from typing import Final

try:
    from select import select
except ImportError:  # pragma: no cover - Windows fallback
    select = None  # type: ignore[assignment]

DEFAULT_TIMEOUT: Final[float] = 5.0


def _read_fifo(path: Path, timeout: float) -> str:
    if select is None:
        raise RuntimeError(
            "This platform does not support select() on FIFOs. Use the 1Password CLI "
            "to export your env file instead."
        )
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    chunks: list[bytes] = []
    try:
        remaining = timeout
        while True:
            if remaining <= 0:
                raise TimeoutError(
                    f"Timed out waiting for data from FIFO {path}. "
                    "Ensure the 1Password app/CLI is running."
                )
            ready, _, _ = select([fd], [], [], remaining)
            if not ready:
                raise TimeoutError(
                    f"No data received from {path} within {timeout} seconds."
                )
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            chunks.append(chunk)
            remaining = timeout  # reset after data arrives so multi-chunk pipes succeed
    finally:
        os.close(fd)
    data = b"".join(chunks).decode("utf-8", errors="replace")
    if not data.strip():
        raise RuntimeError(
            f"FIFO {path} produced no data. Launch 1Password or use `op run` to hydrate the file."
        )
    return data


def _read_env_file(path: Path, timeout: float) -> str:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError as exc:  # pragma: no cover - CLI guard
        raise FileNotFoundError(f"Env source {path} not found") from exc

    if stat.S_ISFIFO(mode):
        return _read_fifo(path, timeout)
    return path.read_text(encoding="utf-8")


def _write_env_file(path: Path, data: str) -> None:
    path.write_text(data, encoding="utf-8")
    os.chmod(path, 0o600)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Materialize secrets from a 1Password-managed .env.real file into a normal .env",
    )
    parser.add_argument(
        "--src",
        default=".env.real",
        help="Source env file (defaults to .env.real)",
    )
    parser.add_argument(
        "--dest",
        default=".env",
        help="Destination env file (defaults to .env)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help="Seconds to wait for FIFO data (default: 5s)",
    )
    args = parser.parse_args()

    src = Path(args.src)
    dest = Path(args.dest)

    try:
        data = _read_env_file(src, args.timeout)
    except Exception as exc:  # pragma: no cover - CLI surface
        print(f"error: {exc}", file=sys.stderr)
        return 1

    _write_env_file(dest, data)
    print(f"Wrote {dest} ({len(data.splitlines())} lines) from {src}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
