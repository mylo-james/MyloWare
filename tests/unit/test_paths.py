from __future__ import annotations

from pathlib import Path

from myloware.paths import get_repo_root


def test_get_repo_root_falls_back_to_cwd(monkeypatch) -> None:
    # Ensure the cache doesn't retain a real repo root from earlier tests.
    get_repo_root.cache_clear()

    sentinel = Path("/tmp/myloware_sentinel_repo_root")

    monkeypatch.setattr(Path, "cwd", staticmethod(lambda: sentinel))
    monkeypatch.setattr(Path, "is_file", lambda _self: False)

    assert get_repo_root() == sentinel

    get_repo_root.cache_clear()
