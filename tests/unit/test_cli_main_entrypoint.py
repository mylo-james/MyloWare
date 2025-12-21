from __future__ import annotations

import runpy
import sys

import pytest


def test_cli_main_runs_as_module(monkeypatch) -> None:
    monkeypatch.setattr(sys, "argv", ["myloware", "--help"])
    sys.modules.pop("myloware.cli.main", None)
    with pytest.raises(SystemExit) as excinfo:
        runpy.run_module("myloware.cli.main", run_name="__main__")
    assert excinfo.value.code == 0
