"""Supervisor agent for workflow management."""

from __future__ import annotations

from typing import Any, List

from myloware.agents.factory import create_persona_agent
from myloware.agents.tools.supervisor import (
    ApproveGateTool,
    GetRunStatusTool,
    ListRunsTool,
    StartWorkflowTool,
)
from myloware.config.loaders import load_agent_config
from llama_stack_client import LlamaStackClient
from llama_stack_client.lib.agents.agent import Agent
from myloware.observability.logging import get_logger

logger = get_logger(__name__)

__all__ = ["create_supervisor_agent"]


def create_supervisor_agent(
    client: LlamaStackClient,
    model: str | None = None,
    vector_db_id: str = "project_kb",
    project: str = "aismr",
) -> Agent:
    """Create Supervisor agent with workflow management tools.

    Unlike other agents, the supervisor requires runtime-instantiated custom tools
    (StartWorkflowTool, ApproveGateTool, etc.) that can't be defined in YAML.
    Instructions are loaded from YAML config while tools are built dynamically.

    Args:
        client: Llama Stack client
        model: Optional model override
        vector_db_id: Vector DB for RAG
        project: Project name for config loading

    Returns:
        Configured supervisor Agent
    """
    # Load instructions from YAML config
    config = load_agent_config(project, "supervisor")
    instructions = config.get("instructions", "")

    if not instructions:
        raise ValueError("No instructions found in supervisor config")

    # Build tools list - custom tools + builtin tools
    tools: List[Any] = [
        # Custom MyloWare tools for workflow management
        StartWorkflowTool(vector_db_id=vector_db_id),
        GetRunStatusTool(),
        ListRunsTool(),
        ApproveGateTool(vector_db_id=vector_db_id),
    ]

    # Add RAG tool (file_search) if vector_db_id is provided
    if vector_db_id:
        tools.append(
            {
                "type": "file_search",
                "vector_store_ids": [vector_db_id],
            }
        )

    # Use model from config if not overridden
    model_id = model or config.get("model")

    agent = create_persona_agent(
        client=client,
        persona_name="supervisor",
        instructions=instructions,
        tools=tools,
        model_id=model_id,
    )

    logger.info("Supervisor agent created with %d tools", len(tools))
    return agent
