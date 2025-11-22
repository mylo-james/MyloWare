from __future__ import annotations

from apps.orchestrator.supervisor import Decision, decide_supervisor_action


def test_decide_supervisor_action_run() -> None:
    assert decide_supervisor_action(0.70) == "run"
    assert decide_supervisor_action(0.95) == "run"
    assert decide_supervisor_action(1.5) == "run"  # clamped


def test_decide_supervisor_action_clarify() -> None:
    assert decide_supervisor_action(0.40) == "clarify"
    assert decide_supervisor_action(0.69) == "clarify"


def test_decide_supervisor_action_decline() -> None:
    assert decide_supervisor_action(0.0) == "decline"
    assert decide_supervisor_action(0.39) == "decline"
    assert decide_supervisor_action(-0.1) == "decline"  # clamped

