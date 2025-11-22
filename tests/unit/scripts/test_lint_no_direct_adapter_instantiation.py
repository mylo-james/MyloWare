from __future__ import annotations

from pathlib import Path

import pytest

from scripts.dev import lint_no_direct_adapter_instantiation as lint


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_reports_violation_for_direct_client_instantiation(tmp_path: Path) -> None:
    apps_dir = tmp_path / "apps"
    write(apps_dir / "foo.py", "from adapters.ai_providers.kieai.client import KieAIClient\nclient = KieAIClient()\n")

    violations = lint.find_violations(tmp_path, ["apps"])
    assert len(violations) == 1
    assert "foo.py" in violations[0]
    assert "KieAIClient(" in violations[0]


def test_passes_when_only_factories_used(tmp_path: Path) -> None:
    apps_dir = tmp_path / "apps"
    write(apps_dir / "bar.py", "from adapters.ai_providers.kieai.factory import get_kieai_client\nclient = get_kieai_client(settings)\n")

    violations = lint.find_violations(tmp_path, ["apps"])
    assert violations == []


def test_skips_nonexistent_scan_dirs(tmp_path: Path) -> None:
    violations = lint.find_violations(tmp_path, ["apps"])
    assert violations == []
