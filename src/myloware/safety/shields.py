"""Llama Stack native safety checks.

Provides content validation using Llama Stack's Safety API.
In 0.3.x, safety is NOT built into Agent - use these helpers.

Two approaches:
1. Shields API (client.safety.run_shield) - Llama Stack native
2. Moderations API (client.moderations.create) - OpenAI-compatible

Usage:
    from myloware.safety.shields import check_content_safety, moderate_content

    # Shields API
    result = await check_content_safety(client, content)

    # Moderations API (richer response)
    result = await moderate_content(client, content)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

import anyio
from llama_stack_client import AsyncLlamaStackClient, LlamaStackClient

from myloware.config import settings
from myloware.config.provider_modes import effective_llama_stack_provider
from myloware.observability.logging import get_logger

logger = get_logger(__name__)

__all__ = [
    "SafetyResult",
    "ModerationResult",
    "check_content_safety",
    "check_brief_safety",
    "moderate_content",
    "CONTENT_SAFETY_SHIELD",
]

# Default shield ID (must match server registration)
CONTENT_SAFETY_SHIELD = settings.content_safety_shield_id

# Default moderation model
DEFAULT_MODERATION_MODEL = "meta-llama/Llama-Guard-3-8B"


@dataclass
class SafetyResult:
    """Result from a safety shield check."""

    safe: bool
    reason: str | None = None
    category: str | None = None
    severity: str | None = None

    @classmethod
    def passed(cls) -> "SafetyResult":
        """Create a passing result."""
        return cls(safe=True)

    @classmethod
    def failed(
        cls, reason: str, category: str | None = None, severity: str | None = None
    ) -> "SafetyResult":
        """Create a failing result."""
        return cls(safe=False, reason=reason, category=category, severity=severity)

    @classmethod
    def from_shield_response(cls, response: Any) -> "SafetyResult":
        """Create from Llama Stack shield response."""
        violation = getattr(response, "violation", None)
        if violation is None:
            return cls.passed()

        return cls.failed(
            reason=getattr(violation, "user_message", None)
            or getattr(violation, "explanation", "Content flagged"),
            category=getattr(violation, "category", None),
            severity=getattr(violation, "severity", None),
        )


@dataclass
class ModerationResult:
    """Result from the Moderations API (OpenAI-compatible)."""

    flagged: bool
    categories: Dict[str, bool] = field(default_factory=dict)
    category_scores: Dict[str, float] = field(default_factory=dict)
    violation_types: List[str] = field(default_factory=list)

    @classmethod
    def from_response(cls, response: Any) -> "ModerationResult":
        """Create from Moderations API response."""
        if not response.results:
            return cls(flagged=False)

        result = response.results[0]
        return cls(
            flagged=getattr(result, "flagged", False),
            categories=dict(getattr(result, "categories", {})),
            category_scores=dict(getattr(result, "category_scores", {})),
            violation_types=getattr(result, "metadata", {}).get("violation_type", []),
        )

    @property
    def safe(self) -> bool:
        """Alias for not flagged."""
        return not self.flagged

    def get_top_categories(self, threshold: float = 0.5) -> List[str]:
        """Get categories with scores above threshold."""
        return [cat for cat, score in self.category_scores.items() if score >= threshold]


async def _run_shield(
    client: LlamaStackClient | AsyncLlamaStackClient,
    shield_id: str,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run shield with sync or async client."""
    logger.debug(
        "_run_shield called",
        shield_id=shield_id,
        client_type=type(client).__name__,
        is_async=isinstance(client, AsyncLlamaStackClient),
    )
    if isinstance(client, AsyncLlamaStackClient):
        logger.debug("Calling async client.safety.run_shield with shield_id: %s", shield_id)
        result = await client.safety.run_shield(
            shield_id=shield_id,
            messages=messages,
            params={},
        )
        logger.debug(
            "Async run_shield completed",
            shield_id=shield_id,
            has_violation=result.violation is not None,
        )
        return result
    logger.debug("Calling sync client.safety.run_shield with shield_id: %s", shield_id)
    result = await anyio.to_thread.run_sync(
        lambda: client.safety.run_shield(shield_id=shield_id, messages=messages, params={})
    )
    logger.debug(
        "Sync run_shield completed", shield_id=shield_id, has_violation=result.violation is not None
    )
    return result


async def check_content_safety(
    client: LlamaStackClient | AsyncLlamaStackClient,
    content: str,
    shield_id: str = CONTENT_SAFETY_SHIELD,
) -> SafetyResult:
    """Check content against Llama Stack safety shield.

    Uses the native Safety API for content moderation.

    Args:
        client: Llama Stack client
        content: Content to check
        shield_id: Shield to use (default: together/meta-llama/Llama-Guard-4-12B)

    Returns:
        SafetyResult with safe=True if content passes, False with reason if flagged
    """
    logger.debug(
        "check_content_safety called",
        shield_id=shield_id,
        default_shield=CONTENT_SAFETY_SHIELD,
        settings_shield=settings.content_safety_shield_id,
        shield_id_match=(shield_id == CONTENT_SAFETY_SHIELD),
    )
    if effective_llama_stack_provider(settings) != "real":
        # In local/test mode we skip remote shield calls to avoid dependency on a running Llama Stack.
        return SafetyResult.passed()
    try:
        logger.debug("Calling _run_shield with shield_id: %s", shield_id)
        response = await _run_shield(
            client,
            shield_id=shield_id,
            messages=[{"role": "user", "content": content}],
        )

        result = SafetyResult.from_shield_response(response)

        if result.safe:
            logger.debug("Content passed safety check", shield=shield_id)
        else:
            logger.warning(
                "Content flagged by safety shield",
                shield=shield_id,
                category=result.category,
                severity=result.severity,
                reason=result.reason,
            )

        return result

    except Exception as exc:
        # Always fail closed - safety is critical
        logger.error(
            "Safety check failed",
            exc=str(exc),
            exc_type=type(exc).__name__,
            shield_id=shield_id,
            exc_repr=repr(exc),
        )
        logger.warning("Safety check error - failing CLOSED (safety must always fail closed)")
        return SafetyResult.failed(
            reason=f"Safety check unavailable: {exc}",
            category="system_error",
        )


async def moderate_content(
    client: LlamaStackClient,
    content: str,
    model: str = DEFAULT_MODERATION_MODEL,
) -> ModerationResult:
    """Check content using OpenAI-compatible Moderations API.

    This API provides richer category information than shields.

    Args:
        client: Llama Stack client
        content: Content to moderate
        model: Moderation model (default: Llama-Guard-3-8B)

    Returns:
        ModerationResult with flagged status and category scores
    """
    try:
        response = client.moderations.create(
            model=model,
            input=[content],
        )

        result = ModerationResult.from_response(response)

        if result.flagged:
            logger.warning(
                "Content flagged by moderation",
                model=model,
                categories=result.get_top_categories(),
                violation_types=result.violation_types,
            )
        else:
            logger.debug("Content passed moderation", model=model)

        return result

    except Exception as exc:
        logger.error("Moderation check failed: %s", exc)
        # Always fail closed - treat errors as flagged content
        return ModerationResult(flagged=True, categories={"system_error": True})


async def check_brief_safety(
    client: LlamaStackClient,
    brief: str,
    shield_id: str = CONTENT_SAFETY_SHIELD,
) -> SafetyResult:
    """Check a workflow brief before starting video generation.

    Call this BEFORE creating a run to catch unsafe content early
    and avoid wasting API credits on inappropriate requests.

    Args:
        client: Llama Stack client
        brief: User's workflow brief
        shield_id: Shield to use

    Returns:
        SafetyResult - check result.safe before proceeding

    Example:
        result = await check_brief_safety(client, user_brief)
        if not result.safe:
            raise HTTPException(400, f"Brief rejected: {result.reason}")
    """
    logger.debug(
        "Checking brief safety before workflow", brief_length=len(brief), shield_id=shield_id
    )
    logger.debug("Using shield_id: %s (CONTENT_SAFETY_SHIELD=%s)", shield_id, CONTENT_SAFETY_SHIELD)
    return await check_content_safety(client, brief, shield_id)


async def check_agent_input(
    client: LlamaStackClient,
    messages: List[Dict[str, str]],
    shield_id: str = CONTENT_SAFETY_SHIELD,
) -> SafetyResult:
    """Check agent input messages before create_turn.

    Since 0.3.x Agent doesn't have built-in shields, call this before
    agent.create_turn() to screen user inputs.

    Args:
        client: Llama Stack client
        messages: Messages about to be sent to agent
        shield_id: Shield to use

    Returns:
        SafetyResult
    """
    # Check last user message
    user_messages = [m for m in messages if m.get("role") == "user"]
    if not user_messages:
        return SafetyResult.passed()

    last_user_content = user_messages[-1].get("content", "")
    return await check_content_safety(client, last_user_content, shield_id)


async def check_agent_output(
    client: LlamaStackClient,
    response_content: str,
    shield_id: str = CONTENT_SAFETY_SHIELD,
) -> SafetyResult:
    """Check agent response after create_turn.

    Since 0.3.x Agent doesn't have built-in output shields, call this after
    agent.create_turn() to screen agent responses.

    Args:
        client: Llama Stack client
        response_content: Agent's response text
        shield_id: Shield to use

    Returns:
        SafetyResult
    """
    return await check_content_safety(client, response_content, shield_id)
