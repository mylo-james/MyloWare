from __future__ import annotations

import json
import os
import subprocess
import sys


def test_observability_does_not_configure_logging_on_import() -> None:
    """Importing myloware.* should not mutate global structlog config."""
    code = r"""
import json
import structlog

before = structlog.is_configured()

import myloware.observability as obs  # noqa: F401

after_import = structlog.is_configured()

obs.init_observability()
after_init = structlog.is_configured()

print(json.dumps({"before": before, "after_import": after_import, "after_init": after_init}))
"""
    env = os.environ.copy()
    env["PYTHONPATH"] = "src"
    proc = subprocess.run(
        [sys.executable, "-c", code],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    payload = json.loads(proc.stdout.strip())
    assert payload["before"] is False
    assert payload["after_import"] is False
    assert payload["after_init"] is True
