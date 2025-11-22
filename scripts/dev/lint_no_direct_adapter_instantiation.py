"""Lint to ensure adapter clients are only instantiated via factories."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable, Sequence

BANNED_TOKENS = (
    "KieAIClient(",
    "ShotstackClient(",
    "UploadPostClient(",
)
DEFAULT_SCAN_DIRS = ("apps",)
ALLOWED_RELATIVE_PATHS = {
    Path("adapters/ai_providers/kieai/factory.py"),
    Path("adapters/ai_providers/shotstack/factory.py"),
    Path("adapters/social/upload_post/factory.py"),
}


def find_violations(root: Path, scan_dirs: Sequence[str]) -> list[str]:
    root = root.resolve()
    violations: list[str] = []
    for rel in scan_dirs:
        scan_path = (root / rel).resolve()
        if not scan_path.exists():
            continue
        for path in scan_path.rglob("*.py"):
            rel_path = path.relative_to(root)
            if _is_allowed_file(rel_path):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            token = _first_banned_token(text)
            if token:
                violations.append(f"{rel_path}: forbidden direct instantiation '{token}'")
    return violations


def _is_allowed_file(rel_path: Path) -> bool:
    if rel_path in ALLOWED_RELATIVE_PATHS:
        return True
    parts = set(rel_path.parts)
    return "tests" in parts


def _first_banned_token(text: str) -> str | None:
    for token in BANNED_TOKENS:
        if token in text:
            return token
    return None


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        default=DEFAULT_SCAN_DIRS,
        help="directories (relative to repo root) to scan",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    repo_root = Path(__file__).resolve().parents[2]
    violations = find_violations(repo_root, args.paths)
    if violations:
        for violation in violations:
            print(violation)
        print(
            "Direct adapter client instantiations are forbidden. Use the factories instead.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
