"""Agent factory for creating Llama Stack persona agents.

Supports two modes:
1. Direct creation with explicit instructions (create_persona_agent)
2. Config-driven creation from YAML files (create_agent)

Tools are created per-agent with run context (run_id) for webhook callbacks.
This is the Llama Stack native approach - tools have full context at creation time.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List
from uuid import UUID

from langfuse import observe
from llama_stack_client import LlamaStackClient
from llama_stack_client.lib.agents.agent import Agent

from config import settings
from config.loaders import load_agent_config
from tools import (
    KIEGenerationTool,
    RemotionRenderTool,
    UploadPostTool,
)

logger = logging.getLogger(__name__)

__all__ = [
    "create_agent",
    "create_persona_agent",
    "create_rag_tool_config",
    "DEFAULT_SHIELDS",
    "DEFAULT_SAMPLING_PARAMS",
]

# Default safety shields applied to all agents
# Note: Empty by default as llama_guard may not be available in all distributions
DEFAULT_SHIELDS: List[str] = []

# Default sampling parameters (greedy for deterministic output)
DEFAULT_SAMPLING_PARAMS: Dict[str, Any] = {
    "strategy": {"type": "greedy"},
}


def create_persona_agent(
    client: LlamaStackClient,
    persona_name: str,
    instructions: str,
    tools: List[Any] | None = None,
    model_id: str | None = None,
    input_shields: List[str] | None = None,
    output_shields: List[str] | None = None,
    sampling_params: Dict[str, Any] | None = None,
) -> Agent:
    """
    Create a Llama Stack Agent for a persona.

    This factory ensures consistent configuration across all persona agents.
    Note: Shields and sampling_params are currently not supported in the
    latest llama_stack_client Agent class - they are preserved for future use.
    """
    if not persona_name:
        raise ValueError("persona_name is required")
    if not instructions:
        raise ValueError("instructions is required")

    model = model_id or settings.llama_stack_model
    agent_tools = tools or []

    logger.info(
        "Creating persona agent: name=%s, model=%s, tools=%d",
        persona_name,
        model,
        len(agent_tools),
    )

    agent = Agent(
        client=client,
        model=model,
        instructions=instructions,
        tools=agent_tools,
    )

    logger.info("Created agent for persona '%s'", persona_name)
    return agent


def create_rag_tool_config(vector_db_ids: List[str] | str) -> Dict[str, Any]:
    """
    Create a RAG tool configuration for agents using file_search.
    """
    if isinstance(vector_db_ids, str):
        vector_db_ids = [vector_db_ids]

    return {
        "type": "file_search",
        "vector_store_ids": vector_db_ids,
    }


@observe(name="create_agent")
def create_agent(
    client: LlamaStackClient,
    project: str,
    role: str,
    vector_db_id: str | None = None,
    run_id: UUID | str | None = None,
    custom_tools: List[Any] | None = None,
) -> Agent:
    """Create a Llama Stack agent from project config.

    Loads agent configuration from YAML files with inheritance:
    - Base config from data/shared/agents/{role}.yaml
    - Project override from data/projects/{project}/agents/{role}.yaml (if exists)

    Args:
        client: Llama Stack client
        project: Project name (e.g., "aismr", "test_video_gen")
        role: Agent role (ideator, producer, editor, publisher, supervisor)
        vector_db_id: Optional vector DB ID for RAG tools
        run_id: Optional run ID for webhook-enabled tools (KIE, Remotion)
        custom_tools: Optional additional tools to add

    Returns:
        Configured Llama Stack Agent
    """
    # Load config with inheritance
    config = load_agent_config(project, role)

    logger.info("Creating %s agent for project %s (run_id=%s)", role, project, run_id)

    # Build tools list from config - tools are created per-run with context
    tools = _build_tools_from_config(
        config.get("tools", []),
        vector_db_id=vector_db_id,
        run_id=run_id,
    )

    # Add custom tools
    if custom_tools:
        tools.extend(custom_tools)

    # Note: Shields are configured at the Llama Stack server level, not per-agent.
    # The shields config in YAML is parsed but not used by the client Agent class.
    # See llama_stack/run.yaml for server-level safety configuration.

    # Get model from config or settings
    model = config.get("model") or settings.llama_stack_model

    # Get instructions
    instructions = config.get("instructions", "")
    if not instructions:
        raise ValueError(f"No instructions found in config for {role}")

    # Note: The current llama_stack_client Agent class doesn't support
    # input_shields, output_shields, or sampling_params directly.
    # These would need to be configured via the Llama Stack server config.
    agent = Agent(
        client=client,
        model=model,
        instructions=instructions,
        tools=tools,
    )

    logger.info("Created %s agent with %d tools: %s", role, len(tools), tools)
    return agent


def _build_tools_from_config(
    tool_names: List[str | Dict[str, Any]],
    vector_db_id: str | None,
    run_id: UUID | str | None = None,
) -> List[Any]:
    """Build tool list from config, injecting context where needed.

    Tools are created fresh per-agent with full context (run_id, vector_db_id).
    This is the Llama Stack native approach - no global caching of stateful tools.

    Handles:
    - builtin:: tools (RAG, memory, websearch)
    - Custom MyloWare tools (kie_generate, remotion_render, upload_post)

    Args:
        tool_names: List of tool names or tool configs from YAML
        vector_db_id: Optional vector DB ID to inject into RAG tools
        run_id: Optional run ID for webhook-enabled tools

    Returns:
        List of tool configurations (strings for builtin, instances for custom)
    """
    tools: List[Any] = []

    # Convert run_id to string if it's a UUID
    run_id_str = str(run_id) if run_id else None

    for tool in tool_names:
        if isinstance(tool, str):
            # String tool name
            tool_instance = _create_tool_instance(tool, vector_db_id, run_id_str)
            if tool_instance is not None:
                tools.append(tool_instance)
        elif isinstance(tool, dict):
            # Dict tool config - pass through as-is
            # The tool may already be in the new format (type: file_search)
            tools.append(tool)

    return tools


def _create_tool_instance(
    tool_name: str,
    vector_db_id: str | None,
    run_id: str | None = None,
) -> Any:
    """Create a tool instance from a tool name.

    Custom tools (KIE, Remotion, etc.) are created fresh each time with
    run context. This enables webhook callbacks to include run_id.

    Returns:
        - Tool instance for custom tools
        - Dict config for builtin tools that need args
        - String for simple builtin tools
        - None if tool should be skipped
    """
    # RAG tool - convert to new file_search format
    if tool_name == "builtin::rag/knowledge_search":
        if vector_db_id:
            return create_rag_tool_config(vector_db_id)
        logger.warning("RAG tool requested but no vector_db_id provided, skipping")
        return None

    # Websearch tool - use web_search type
    if tool_name == "builtin::websearch":
        return {
            "type": "web_search",
            "engine": "brave",
        }

    # Other builtin tools - skip (not supported in new API)
    if tool_name.startswith("builtin::"):
        logger.warning("Unsupported builtin tool '%s', skipping", tool_name)
        return None

    # Custom MyloWare tools - create fresh instances with run context
    # These are NOT cached because they may contain run-specific state

    if tool_name == "kie_generate":
        tool_instance = KIEGenerationTool(run_id=run_id)
        logger.info("Created KIEGenerationTool (run_id=%s)", run_id)
        return tool_instance

    if tool_name == "remotion_render":
        tool_instance = RemotionRenderTool(run_id=run_id)
        logger.info("Created RemotionRenderTool (run_id=%s)", run_id)
        return tool_instance

    elif tool_name == "upload_post":
        tool_instance = UploadPostTool()
        logger.info("Created UploadPostTool instance")
        return tool_instance

    else:
        # Unknown tool - pass through as string (might be registered elsewhere)
        logger.warning("Unknown tool '%s', passing through as string", tool_name)
        return tool_name
