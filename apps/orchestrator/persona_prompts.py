"""Persona prompt and context composition helpers."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

logger = logging.getLogger("myloware.orchestrator.persona_prompts")

_MODULE_ROOT = Path(__file__).resolve().parents[2]
_CWD_ROOT = Path.cwd()
_APP_ROOT = Path("/app")
_DEFAULT_PERSONA_DIRS: list[Path] = [
    _MODULE_ROOT / "data" / "personas",
    _CWD_ROOT / "data" / "personas",
    _APP_ROOT / "data" / "personas",
]
_PERSONA_DIR_CANDIDATES: list[Path] = list(dict.fromkeys(_DEFAULT_PERSONA_DIRS))

__all__ = [
    "load_persona_prompt",
    "compose_system_prompt",
    "project_specs",
    "build_persona_user_message",
]


def _iter_persona_dirs(extra: Sequence[Path] | None = None) -> Iterable[Path]:
    """Yield persona directories without duplicates."""
    seen: set[Path] = set()
    for base in list(_PERSONA_DIR_CANDIDATES) + list(extra or []):
        if not base:
            continue
        normalized = base.resolve()
        if normalized in seen:
            continue
        seen.add(normalized)
        yield normalized


def load_persona_prompt(persona: str) -> str:
    """Return the persona prompt markdown or fall back to JSON/default text."""
    persona_slug = str(persona or "").lower()
    prompt_candidates = [
        directory / persona_slug / "prompt.md" for directory in _iter_persona_dirs()
    ]

    for prompt_path in prompt_candidates:
        logger.info(
            "Loading persona prompt from %s (exists=%s)", prompt_path, prompt_path.exists()
        )
        if prompt_path.exists():
            try:
                content = prompt_path.read_text(encoding="utf-8")
                logger.info(
                    "Loaded prompt.md for %s (path=%s, content_length=%s)",
                    persona_slug,
                    prompt_path,
                    len(content),
                )
                return content
            except Exception as exc:  # pragma: no cover - filesystem failures unexpected
                logger.error(
                    "Failed to load persona prompt markdown",
                    extra={"persona": persona_slug, "path": str(prompt_path)},
                    exc_info=exc,
                )

    # Fall back to persona JSON definitions
    json_candidates: list[Path] = []
    for directory in _iter_persona_dirs():
        json_candidates.append(directory / persona_slug / "persona.json")
        json_candidates.append(directory / f"{persona_slug}.json")

    for json_path in json_candidates:
        if json_path.exists():
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
                prompt = data.get("systemPrompt") or data.get("prompt") or data.get("description")
                if prompt:
                    return str(prompt)
            except Exception as exc:  # pragma: no cover - corrupted JSON
                logger.error(
                    "Failed to load persona JSON prompt",
                    extra={"persona": persona_slug, "path": str(json_path)},
                    exc_info=exc,
                )

    return f"You are {persona_slug.title()}, a helpful teammate following the MyloWare workflow."


def compose_system_prompt(persona: str, context: Mapping[str, Any]) -> str:
    """Compose the LangChain system prompt from persona files + run context."""
    base = load_persona_prompt(persona).strip()
    sections: list[str] = [base] if base else []

    allowed_tools = context.get("allowed_tools") or []
    if isinstance(allowed_tools, list) and allowed_tools:
        tool_list_md = "\n".join(f"- `{tool}`" for tool in allowed_tools)
        sections.append(
            "## Available Tools\n\n"
            f"{tool_list_md}\n\n"
            "**CRITICAL**: You MUST use these tools to complete your work. "
            "Calling only `memory_search` is insufficient — invoke your specialized tools "
            "before considering the task complete."
        )

    instructions = context.get("instructions")
    if instructions:
        formatted = str(instructions).strip()
        lower = formatted.lower()
        if formatted and not lower.startswith("objective"):
            sections.append(f"Objective:\n{formatted}")
        else:
            sections.append(formatted)

    materials = context.get("materials")
    material_lines: list[str] = []
    if isinstance(materials, Mapping):
        brief = materials.get("input")
        if brief:
            material_lines.append(f"User brief: {brief}")
        videos = materials.get("videos")
        if isinstance(videos, list) and videos:
            material_lines.append(f"Clips referenced: {len(videos)}")
    if material_lines:
        sections.append("\n".join(material_lines))

    project_spec = context.get("project_spec")
    if isinstance(project_spec, Mapping) and project_spec:
        specs = project_specs(project_spec)
        try:
            serialized = json.dumps(specs, indent=2, sort_keys=True)
        except TypeError:
            serialized = str(specs)
        sections.append("Project specs:\n" + serialized)

    constraints = context.get("constraints")
    if isinstance(constraints, Mapping):
        guardrails = constraints.get("guardrails")
        if isinstance(guardrails, Mapping):
            summary = guardrails.get("summary")
            if summary:
                sections.append(f"Guardrails summary: {summary}")

    return "\n\n".join(section for section in sections if section).strip()


def project_specs(project_spec: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """Return the nested `specs` section when present."""
    if isinstance(project_spec, Mapping):
        specs = project_spec.get("specs")
        if isinstance(specs, Mapping):
            return specs
        return project_spec
    return {}


def _pretty_json(value: Any) -> str:
    try:
        return json.dumps(value, indent=2, sort_keys=True)
    except TypeError:
        return str(value)


def build_persona_user_message(
    persona: str, context: Mapping[str, Any], state: Mapping[str, Any]
) -> str:
    """Render the user message sent to LangChain agents."""
    lines: list[str] = []
    run_id = context.get("run_id") or state.get("run_id")
    project = context.get("project") or state.get("project")
    if run_id:
        lines.append(f"Run ID: {run_id}")
    if project:
        lines.append(f"Project: {project}")
    if persona:
        lines.append(f"Current persona: {persona}")

    run_input = context.get("run_input") or state.get("input")
    if run_input:
        if isinstance(run_input, Mapping):
            lines.append("Run brief:\n" + _pretty_json(run_input))
        else:
            lines.append(f"Run brief: {run_input}")

    videos = state.get("videos") or context.get("videos")
    if isinstance(videos, list) and videos:
        lines.append("Videos JSON:\n" + _pretty_json(videos))

    clips = state.get("clips") or context.get("clips")
    if isinstance(clips, list) and clips:
        lines.append("Clips JSON:\n" + _pretty_json(clips))

    options = context.get("options") or state.get("options")
    if isinstance(options, Mapping) and options:
        lines.append("Options:\n" + _pretty_json(options))

    allowed = context.get("allowed_tools") or []
    if isinstance(allowed, list) and allowed:
        lines.append("Allowed LangChain tools: " + ", ".join(str(tool) for tool in allowed if tool))

    lines.append(
        "Advance this persona stage using the available tools. "
        "Call the required tools (especially any non-memory tools) before responding."
    )
    return "\n\n".join(lines)
