"""Persona contract definitions and validation helpers.

This module centralizes the required-tool contracts for each persona and the
logic that validates LangChain tool call traces after a persona step
completes. It is imported by ``persona_nodes`` and exercised directly in
unit tests.
"""
from __future__ import annotations

from typing import Any, Mapping, Sequence


_PERSONA_CONTRACTS: dict[str, dict[str, str]] = {
    "iggy": {
        "memory_search": "Use memory_search to reload the creative direction guardrails before ideating.",
    },
    "riley": {
        "memory_search": "Use memory_search to pull the Veo3 prompting guidelines before scripting.",
        "submit_generation_jobs_tool": "Call submit_generation_jobs_tool so kie.ai actually renders the clips.",
    },
    "alex": {
        "render_video_timeline_tool": "render_video_timeline_tool auto-builds the Shotstack template; call it once per run.",
    },
    "quinn": {
        "memory_search": "Use memory_search to restate the platform requirements before publishing.",
        "publish_to_tiktok_tool": "publish_to_tiktok_tool is required to record the canonical URL.",
    },
}


def _extract_tool_call_names(result_messages: Sequence[Any] | None) -> set[str]:
    names: set[str] = set()
    if not result_messages:
        return names
    for message in result_messages:
        raw_calls: Any = None
        if isinstance(message, Mapping):
            raw_calls = message.get("tool_calls") or message.get("toolCalls")
            if not raw_calls:
                additional = message.get("additional_kwargs")
                if isinstance(additional, Mapping):
                    raw_calls = additional.get("tool_calls") or additional.get("toolCalls")
        else:
            raw_calls = getattr(message, "tool_calls", None) or getattr(message, "toolCalls", None)
            if not raw_calls:
                additional = getattr(message, "additional_kwargs", None)
                if isinstance(additional, Mapping):
                    raw_calls = additional.get("tool_calls") or additional.get("toolCalls")
        if not raw_calls:
            continue
        for call in raw_calls:
            name = None
            if isinstance(call, Mapping):
                name = call.get("name")
                if not name:
                    function = call.get("function")
                    if isinstance(function, Mapping):
                        name = function.get("name")
            else:
                name = getattr(call, "name", None)
                if not name:
                    function = getattr(call, "function", None)
                    if isinstance(function, Mapping):
                        name = function.get("name")
            if name:
                names.add(str(name).strip().lower())
    return names


def _validate_persona_contract(
    persona: str,
    project: str,
    allowed_tools: Sequence[str] | None,
    result_messages: Sequence[Any] | None,
    run_id: str | None = None,
) -> None:
    """Fail-fast if a persona skipped required tools.

    This function is intentionally strict: if a persona has a contract and a
    required tool is both allowed for the project and missing from the tool
    call trace, it raises ``RuntimeError`` with a descriptive hint so the
    failure is easy to debug in LangSmith and logs.
    """

    persona_key = str(persona or "").lower()
    contract = _PERSONA_CONTRACTS.get(persona_key)
    if not contract:
        return
    allowed = {str(tool).strip().lower() for tool in (allowed_tools or []) if tool}
    called = _extract_tool_call_names(result_messages)
    missing: list[str] = []
    for tool_name in contract:
        if allowed and tool_name not in allowed:
            continue
        if tool_name not in called:
            missing.append(tool_name)
    if not missing:
        return
    hints: list[str] = []
    for tool_name in missing:
        hint = contract.get(tool_name)
        if hint:
            hints.append(hint)
    hint_text = " ".join(hints)
    raise RuntimeError(
        f"Persona '{persona}' failed to call required tools: {', '.join(missing)}. "
        f"{hint_text} (project={project}, run={run_id or 'unknown'})",
    )


__all__ = ["_PERSONA_CONTRACTS", "_validate_persona_contract"]

