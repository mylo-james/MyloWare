from __future__ import annotations

import argparse

from cli.main import build_parser


def test_workflows_command_not_exposed() -> None:
    parser = build_parser()
    subparsers_actions = [
        action for action in parser._actions if isinstance(action, argparse._SubParsersAction)  # type: ignore[attr-defined]
    ]
    # There should be a single top-level subparsers action
    assert subparsers_actions, "expected at least one subparser action"
    subparsers = subparsers_actions[0]
    # Top-level commands should not include a legacy 'workflows' command
    assert "workflows" not in subparsers.choices
