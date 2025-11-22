from __future__ import annotations

from pathlib import Path


def test_docs_readme_mentions_env_profiles() -> None:
    readme = Path("docs/README.md").read_text(encoding="utf-8")
    assert ".env.development" in readme, "docs/README.md must mention .env.development mock profile"
    assert ".env.real" in readme, "docs/README.md must mention .env.real live profile"
