"""Factory for building production graphs dynamically."""
from __future__ import annotations

# mypy: ignore-errors

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from langgraph.graph import END, START, StateGraph

from .config import settings
from .run_state import RunState
from .persona_nodes import create_persona_node
from .hitl_gate import hitl_gate_node, hitl_gate_prepare_node


def load_project_spec(project: str) -> dict[str, Any]:
    """Load project specification from data/projects/{project}/project.json.
    
    Raises FileNotFoundError if project.json cannot be found.
    Raises RuntimeError if project.json exists but cannot be parsed.
    """
    import logging
    logger = logging.getLogger("myloware.orchestrator.graph_factory")
    
    if not project:
        raise ValueError("load_project_spec called with empty project name")
    
    module_root = Path(__file__).resolve().parents[2]
    cwd_root = Path.cwd()
    app_root = Path("/app")

    candidate_files = [
        module_root / "data" / "projects" / project / "project.json",
        module_root / "data" / "projects" / f"{project}.json",
        cwd_root / "data" / "projects" / project / "project.json",
        cwd_root / "data" / "projects" / f"{project}.json",
        app_root / "data" / "projects" / project / "project.json",
        app_root / "data" / "projects" / f"{project}.json",
    ]

    errors: list[str] = []
    for path in candidate_files:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    raise ValueError(f"project.json must be a JSON object, got {type(data)}")
                logger.info(f"Loaded project spec for '{project}' from {path}")
                return data
            except Exception as exc:
                error_msg = f"{path}: {exc}"
                logger.error(f"Failed to parse project spec from {path}: {exc}", exc_info=True)
                errors.append(error_msg)

    # No valid file found
    checked_paths = "\n  - ".join(str(p) for p in candidate_files)
    if errors:
        error_details = "\n  - ".join(errors)
        raise RuntimeError(
            f"Project spec file exists but cannot be parsed for project '{project}'.\n"
            f"Errors:\n  - {error_details}\n\n"
            f"Fix the project.json file to contain valid JSON."
        )
    else:
        raise FileNotFoundError(
            f"Project spec not found for project '{project}'.\n"
            f"Checked paths:\n  - {checked_paths}\n\n"
            f"Create a project.json file in data/projects/{project}/project.json"
        )


def build_project_graph(project_spec: dict[str, Any], project: str = "test_video_gen") -> StateGraph:
    """Build a production graph with one node per persona.
    
    Args:
        project_spec: Project specification with workflow and hitlPoints
        project: Project name for persona context
    
    Returns:
        Compiled StateGraph ready for execution
    """
    workflow = project_spec.get("workflow", ["iggy", "riley", "alex", "quinn"])
    # Filter out supervisor personas (Brendan) from production graphs
    workflow = [p for p in workflow if p not in {"brendan", "supervisor"}]
    hitl_points = (
        project_spec.get("hitlPoints")
        or project_spec.get("settings", {}).get("hitlPoints")
        or []
    )
    
    graph = StateGraph(RunState)
    
    # Add persona nodes
    for persona in workflow:
        node_func = create_persona_node(persona, project)
        graph.add_node(persona, node_func)
    
    # Wire edges: START → first persona
    if workflow:
        graph.add_edge(START, workflow[0])
    
    # Wire sequential flow with handoffs and HITL gates
    # Build edges list first, then add HITL gates where needed
    hitl_nodes_added: set[str] = set()
    hitl_prep_nodes: set[str] = set()
    
    for i in range(len(workflow) - 1):
        current = workflow[i]
        next_persona = workflow[i + 1]
        
        # Check if there's a HITL gate after current persona or before next
        gate_key_after = f"after_{current}"
        gate_key_before = f"before_{next_persona}"
        
        if gate_key_after in hitl_points:
            gate_name = _resolve_gate_name(gate_key_after) or gate_key_after.replace("after_", "")
            _wire_hitl_gate(graph, current, next_persona, gate_name, hitl_nodes_added, hitl_prep_nodes)
        elif gate_key_before in hitl_points:
            gate_name = _resolve_gate_name(gate_key_before) or gate_key_before.replace("before_", "")
            _wire_hitl_gate(graph, current, next_persona, gate_name, hitl_nodes_added, hitl_prep_nodes)
        else:
            graph.add_edge(current, next_persona)
    
    # Last persona → END
    if workflow:
        graph.add_edge(workflow[-1], END)
    
    return graph
def _resolve_gate_name(hitl_point: str | None) -> str | None:
    if not hitl_point:
        return None
    normalized = hitl_point.lower()
    if "ideate" in normalized or "iggy" in normalized:
        return "ideate"
    if "prepublish" in normalized or "quinn" in normalized:
        return "prepublish"
    return None


def _wire_hitl_gate(
    graph: StateGraph,
    source_persona: str,
    target_persona: str,
    gate_name: str,
    hitl_nodes: set[str],
    prep_nodes: set[str],
) -> None:
    hitl_node_name = f"hitl_{gate_name}"
    prep_node_name = f"{hitl_node_name}_prep"

    if prep_node_name not in prep_nodes:
        graph.add_node(prep_node_name, lambda state, g=gate_name: hitl_gate_prepare_node(state, g))
        prep_nodes.add(prep_node_name)

    if hitl_node_name not in hitl_nodes:
        graph.add_node(hitl_node_name, lambda state, g=gate_name: hitl_gate_node(state, g))
        hitl_nodes.add(hitl_node_name)
    graph.add_edge(source_persona, prep_node_name)
    graph.add_edge(prep_node_name, hitl_node_name)
    graph.add_edge(hitl_node_name, target_persona)
