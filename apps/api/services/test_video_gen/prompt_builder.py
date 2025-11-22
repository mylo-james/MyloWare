from __future__ import annotations

from collections.abc import Mapping
from typing import Any
import logging


logger = logging.getLogger("myloware.api.video_pipeline")


def _build_video_prompt(
    base_prompt: str,
    video: Mapping[str, Any],
    *,
    project_spec: Mapping[str, Any] | None = None,
    persona_guidance: str | None = None,
) -> str:
    """Build video generation prompt using guardrails and persona guidance.

    This logic is shared between the real provider pipeline and the mock pipeline.
    """
    subject = video.get("subject")
    header = video.get("header")
    parts: list[str] = []

    # Add persona guidance prefix if available
    if persona_guidance:
        parts.append(persona_guidance)

    # Add base user prompt
    if base_prompt:
        parts.append(str(base_prompt))

    # Add subject description
    if subject:
        parts.append(f"Create a short video featuring the {subject}.")

    # Check guardrails: only add overlay hint if policy allows it
    # Otherwise, Shotstack will handle overlays in post-production
    guardrails = (project_spec or {}).get("guardrails") or {}
    onscreen_policy = str(guardrails.get("onscreen_text_policy", "")).lower()

    # If policy explicitly forbids baking text into kie.ai renders, skip overlay instruction
    should_skip_overlay = (
        header
        and onscreen_policy
        and (
            "do not bake" in onscreen_policy
            or "non-diegetic" in onscreen_policy
            or "shotstack" in onscreen_policy
        )
    )

    if should_skip_overlay:
        # Guardrail forbids baking text - Shotstack will add overlay in post-production
        logger.debug(
            "Skipping overlay text per guardrail",
            extra={"header": header, "policy": onscreen_policy[:100]},
        )
    elif header:
        # Legacy behavior: only if guardrail doesn't forbid it
        # (This branch should rarely execute if guardrails are properly set)
        logger.warning(
            "Adding overlay text despite guardrail check",
            extra={"header": header, "policy": onscreen_policy[:100] if onscreen_policy else "none"},
        )
        parts.append(f"Overlay the header text '{header}'.")

    return " ".join(parts).strip()


