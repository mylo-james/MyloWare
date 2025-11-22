from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Invoke the CLI entrypoint via subprocess in an isolated env."""
    env = os.environ.copy()
    # Avoid loading local .env files during tests
    env["MWPY_SKIP_DOTENV"] = "1"
    # Ensure the project root is on PYTHONPATH so `python -m cli.main` works
    project_root = Path(__file__).resolve().parents[3]
    env["PYTHONPATH"] = os.pathsep.join(
        [str(project_root)] + ([env["PYTHONPATH"]] if "PYTHONPATH" in env else [])
    )
    return subprocess.run(
        [sys.executable, "-m", "cli.main", *args],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def test_cli_entrypoint_help_exits_zero() -> None:
    """Smoke test that the CLI entrypoint is importable and prints help."""
    result = _run_cli("--help")
    assert result.returncode == 0
    assert "MyloWare CLI (Python)" in result.stdout

