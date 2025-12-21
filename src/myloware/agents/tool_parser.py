"""Custom tool parser for Llama models via Together AI.

Llama models output tool calls in text with <|python_tag|> prefix:
<|python_tag|>{
    "type": "function",
    "name": "sora_generate",
    "parameters": {...}
}

This parser extracts those tool calls so they can be executed.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from llama_stack_client.lib.agents.tool_parser import ToolParser
from llama_stack_client.types import CompletionMessage, ToolCall
from myloware.observability.logging import get_logger

logger = get_logger(__name__)

__all__ = ["LlamaToolParser"]

# Pattern to match Llama tool call format
# Matches: <|python_tag|>{...} or just {...} with function/name keys
TOOL_CALL_PATTERN = re.compile(r'<\|python_tag\|>\s*(\{[^{}]*"(?:type|name)"[^{}]*\})', re.DOTALL)

# Also match plain JSON function calls
JSON_FUNCTION_PATTERN = re.compile(
    r'\{\s*"type"\s*:\s*"function"\s*,\s*"name"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[^{}]*\}|\[[^\[\]]*\]|"[^"]*")\s*\}',
    re.DOTALL,
)


class LlamaToolParser(ToolParser):
    """Parse Llama-style tool calls from model output.

    Handles:
    - <|python_tag|>{...} format
    - Plain JSON {"type": "function", "name": "...", "parameters": {...}}
    """

    def get_tool_calls(self, output_message: CompletionMessage) -> List[ToolCall]:
        """Extract tool calls from the model's text output."""
        content = output_message.content
        if not content:
            return []

        # If content is not a string, convert it
        if not isinstance(content, str):
            content = str(content)

        tool_calls: List[ToolCall] = []
        call_id = 0

        # Try to find <|python_tag|> style calls first
        matches = TOOL_CALL_PATTERN.findall(content)
        for match in matches:
            try:
                parsed = json.loads(match)
                tool_call = self._parse_tool_dict(parsed, f"call_{call_id}")
                if tool_call:
                    tool_calls.append(tool_call)
                    call_id += 1
            except json.JSONDecodeError:
                logger.debug("Failed to parse tool call JSON: %s", match[:100])
                continue

        # Avoid double-parsing <|python_tag|> calls as plain JSON.
        content_no_python_tags = TOOL_CALL_PATTERN.sub("", content)

        # Also look for plain JSON function calls
        for match in JSON_FUNCTION_PATTERN.finditer(content_no_python_tags):
            name = match.group(1)
            params_str = match.group(2)
            try:
                # Parse parameters
                if params_str.startswith("{") or params_str.startswith("["):
                    params = json.loads(params_str)
                else:
                    # String parameter - try to parse as JSON
                    params = json.loads(params_str)

                arg_payload = json.dumps(params) if not isinstance(params, str) else params

                tool_call = ToolCall(
                    call_id=f"call_{call_id}",
                    tool_name=name,
                    arguments=arg_payload,
                )
                tool_calls.append(tool_call)
                call_id += 1
                logger.info("Parsed tool call: %s with args: %s", name, params)
            except json.JSONDecodeError:
                logger.debug("Failed to parse parameters: %s", params_str[:100])
                continue

        if tool_calls:
            logger.info("Extracted %d tool calls from model output", len(tool_calls))

        return tool_calls

    def _parse_tool_dict(self, data: Dict[str, Any], call_id: str) -> ToolCall | None:
        """Parse a tool call dictionary into a ToolCall object."""
        name = data.get("name") or data.get("tool_name") or data.get("function")
        if not name:
            return None

        # Get parameters - might be under "parameters", "arguments", or "args"
        params = data.get("parameters") or data.get("arguments") or data.get("args") or {}

        # If params is a string, try to parse it
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                params = {"value": params}

        logger.info("Parsed tool call: %s with args: %s", name, params)

        arg_payload = json.dumps(params) if not isinstance(params, str) else params

        return ToolCall(
            call_id=call_id,
            tool_name=name,
            arguments=arg_payload,
        )
