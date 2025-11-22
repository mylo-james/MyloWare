"""Supervisor decision policy for run / clarify / decline.

The thresholds are documented in AGENTS.md and docs/architecture.md:
- run    when confidence >= 0.70
- clarify when 0.40 <= confidence < 0.70
- decline when confidence < 0.40
"""
from __future__ import annotations

from typing import Literal

Decision = Literal["run", "clarify", "decline"]


def decide_supervisor_action(score: float) -> Decision:
    """Map a confidence score into a supervisor action.

    The score is expected to be in [0.0, 1.0], but values outside the
    range are clamped before applying thresholds.
    """
    # Clamp to sane bounds
    if score < 0.0:
        score = 0.0
    elif score > 1.0:
        score = 1.0

    if score >= 0.70:
        return "run"
    if score >= 0.40:
        return "clarify"
    return "decline"


__all__ = ["Decision", "decide_supervisor_action"]

