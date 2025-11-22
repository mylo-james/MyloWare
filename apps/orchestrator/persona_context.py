"""Persona context builders for LangGraph nodes."""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from .run_state import RunState

logger = logging.getLogger("myloware.orchestrator.persona_context")

# In production (Fly), data lives at /app/data
# In development, it's relative to the repo root
# The installed package location is NOT where data files live
_APP_ROOT = Path("/app") if Path("/app/data").exists() else Path(__file__).resolve().parents[2]
_DATA_DIR = _APP_ROOT / "data"
_PERSONAS_DIR = _DATA_DIR / "personas"
_PROJECTS_DIR = _DATA_DIR / "projects"


def build_persona_context(
    run_state: RunState | Mapping[str, Any],
    project_spec: Mapping[str, Any],
    persona: str,
) -> dict[str, Any]:
    """Return the minimal context each persona needs."""

    system_prompt = _build_system_prompt(str(persona).lower(), project_spec, run_state)
    project_name = str(
        run_state.get("project")
        or project_spec.get("project")
        or project_spec.get("name")
        or project_spec.get("slug")
        or ""
    ).strip()
    
    if not project_name:
        raise RuntimeError(
            f"Cannot build context for persona '{persona}': no project name found in run_state or project_spec. "
            f"This is a critical configuration error that must be fixed."
        )
    
    allowed_tools = _load_allowed_tools(project_name, str(persona).lower())
    run_input = run_state.get("input")
    project_snapshot = dict(project_spec) if isinstance(project_spec, Mapping) else {}
    options = run_state.get("options")
    materials = {
        "input": run_input,
        "videos": list(run_state.get("videos") or []),
        "clips": list(run_state.get("clips") or []),
    }

    context: dict[str, Any] = {
        "system_prompt": system_prompt,
        "run_id": run_state.get("run_id"),
        "project": project_name,
        "videos": list(run_state.get("videos") or []),
        "clips": list(run_state.get("clips") or []),
        "allowed_tools": allowed_tools,
        "project_spec": project_snapshot,
        "run_input": run_input,
        "options": dict(options or {}),
        "materials": materials,
    }
    return context


def _build_system_prompt(persona: str, project_spec: Mapping[str, Any], state: Mapping[str, Any]) -> str:
    sections: list[str] = []
    prompt = _load_persona_prompt(persona).strip()
    if prompt:
        sections.append(prompt)
    run_input = state.get("input")
    if isinstance(run_input, str) and run_input.strip():
        sections.append(f"Run input:\\n{run_input.strip()}")
    if project_spec:
        try:
            serialized = json.dumps(project_spec, indent=2, sort_keys=True)
        except TypeError:
            serialized = str(project_spec)
        sections.append("Project spec:\\n" + serialized)
    return "\\n\\n".join(section for section in sections if section).strip()


def _load_persona_prompt(persona: str) -> str:
    prompt_path = _PERSONAS_DIR / persona / "prompt.md"
    if prompt_path.exists():
        try:
            return prompt_path.read_text(encoding="utf-8")
        except Exception as exc:
            logger.error(f"Failed to read persona prompt from {prompt_path}: {exc}", exc_info=True)
            raise RuntimeError(f"Cannot load prompt for persona '{persona}' from {prompt_path}") from exc
    profile = _load_persona_profile(persona)
    return str(profile.get("systemPrompt") or profile.get("prompt") or "")


@lru_cache(maxsize=None)
def _load_persona_profile(persona: str) -> Mapping[str, Any]:
    candidates = [
        _PERSONAS_DIR / persona / "persona.json",
        _PERSONAS_DIR / f"{persona}.json",
    ]
    for path in candidates:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.error(f"Failed to parse persona profile from {path}: {exc}", exc_info=True)
                raise RuntimeError(f"Cannot load persona profile for '{persona}' from {path}") from exc
    return {"name": persona}


@lru_cache(maxsize=None)
def _load_agent_expectations(project: str) -> Mapping[str, Any]:
    if not project:
        raise ValueError("_load_agent_expectations called with empty project name - this is a bug")
    
    path = _PROJECTS_DIR / project / "agent-expectations.json"
    logger.info(f"Loading agent expectations from: {path} (exists={path.exists()})")
    
    if not path.exists():
        raise FileNotFoundError(
            f"Agent expectations file not found: {path}. "
            f"Every project MUST have an agent-expectations.json file defining persona tools. "
            f"Create {path} with tool configurations for each persona."
        )
    
    try:
        content = path.read_text(encoding="utf-8")
        data = json.loads(content)
        if not isinstance(data, dict):
            raise ValueError(f"Agent expectations must be a JSON object, got {type(data)}")
        logger.info(f"Loaded agent expectations for {project}: personas={list(data.keys())}")
        return data
    except json.JSONDecodeError as exc:
        logger.error(f"Invalid JSON in agent expectations file {path}: {exc}", exc_info=True)
        raise RuntimeError(f"Cannot parse agent expectations from {path}: invalid JSON") from exc
    except Exception as exc:
        logger.error(f"Failed to load agent expectations from {path}: {exc}", exc_info=True)
        raise RuntimeError(f"Cannot load agent expectations from {path}") from exc


def _load_allowed_tools(project: str, persona: str) -> list[str]:
    expectations = _load_agent_expectations(project)
    logger.info(
        f"Loading allowed tools: project='{project}', persona='{persona}', available_personas={list(expectations.keys())}"
    )
    
    persona_cfg = expectations.get(persona)
    if not persona_cfg:
        raise KeyError(
            f"Persona '{persona}' not found in agent expectations for project '{project}'. "
            f"Available personas: {list(expectations.keys())}. "
            f"Add '{persona}' configuration to {_PROJECTS_DIR / project / 'agent-expectations.json'}"
        )
    
    if not isinstance(persona_cfg, Mapping):
        raise TypeError(
            f"Persona '{persona}' configuration must be a dict/mapping, got {type(persona_cfg)}. "
            f"Fix {_PROJECTS_DIR / project / 'agent-expectations.json'}"
        )
    
    raw = persona_cfg.get("tools") or persona_cfg.get("allowed_tools")
    if not raw:
        raise ValueError(
            f"Persona '{persona}' in project '{project}' has no 'tools' or 'allowed_tools' field. "
            f"Every persona MUST define their allowed tools. "
            f"Add a 'tools' array to the '{persona}' section in {_PROJECTS_DIR / project / 'agent-expectations.json'}"
        )
    
    if not isinstance(raw, list):
        raise TypeError(
            f"Persona '{persona}' tools must be a list, got {type(raw)}. "
            f"Fix {_PROJECTS_DIR / project / 'agent-expectations.json'}"
        )
    
    tools = [str(name).strip() for name in raw if name]
    if not tools:
        raise ValueError(
            f"Persona '{persona}' in project '{project}' has an empty tools list. "
            f"Every persona MUST have at least one tool (typically 'memory_search' at minimum). "
            f"Fix {_PROJECTS_DIR / project / 'agent-expectations.json'}"
        )
    
    logger.info(f"Loaded {len(tools)} tools for {persona}: {tools}")
    return tools
