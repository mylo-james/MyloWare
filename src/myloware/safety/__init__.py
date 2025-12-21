"""Safety module - Llama Stack content moderation.

In 0.3.x, safety is NOT built into Agent. Use these helpers
before/after agent.create_turn() for content moderation.

Two APIs available:
1. Shields API (run_shield) - Llama Stack native
2. Moderations API (OpenAI-compatible, richer response)

Usage:
    from myloware.safety import check_brief_safety, SafetyResult
    from myloware.safety import moderate_content, ModerationResult

    # Before workflow
    result = await check_brief_safety(client, brief)
    if not result.safe:
        # Handle unsafe content

    # Before agent turn
    result = await check_agent_input(client, messages)

    # After agent turn
    result = await check_agent_output(client, response_text)
"""

from myloware.safety.shields import (
    CONTENT_SAFETY_SHIELD,
    ModerationResult,
    SafetyResult,
    check_agent_input,
    check_agent_output,
    check_brief_safety,
    check_content_safety,
    moderate_content,
)

__all__ = [
    # Result types
    "SafetyResult",
    "ModerationResult",
    # Shield-based checks
    "check_content_safety",
    "check_brief_safety",
    "check_agent_input",
    "check_agent_output",
    # Moderations API
    "moderate_content",
    # Constants
    "CONTENT_SAFETY_SHIELD",
]
