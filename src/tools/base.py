"""Base class and utilities for custom Llama Stack tools.

This module provides:
- MylowareBaseTool: Base class extending ClientTool with error handling
- format_tool_error: Helper to format error responses
- format_tool_success: Helper to format success responses

Following Llama Stack's native ClientTool pattern from:
llama_stack_client.lib.agents.client_tool
"""

from __future__ import annotations

import json
import logging
from abc import abstractmethod
from typing import Any, Dict, List

import httpx
from llama_stack_client.lib.agents.client_tool import (
    ClientTool,
    CompletionMessage,
    ToolResponse,
)
from llama_stack_client.types import ToolParamDefinition

logger = logging.getLogger(__name__)

__all__ = [
    "MylowareBaseTool",
    "format_tool_error",
    "format_tool_success",
    "ToolParamDefinition",
]


def format_tool_error(
    error_type: str,
    message: str,
    details: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Format a tool error response."""
    response: Dict[str, Any] = {
        "error": True,
        "error_type": error_type,
        "message": message,
    }
    if details:
        response["details"] = details
    return response


def format_tool_success(
    data: Dict[str, Any],
    message: str | None = None,
) -> Dict[str, Any]:
    """Format a tool success response."""
    response: Dict[str, Any] = {"success": True, **data}
    if message:
        response["message"] = message
    return response


class MylowareBaseTool(ClientTool):
    """
    Base class for MyloWare custom tools with standardized error handling.
    
    Follows Llama Stack's native ClientTool pattern.

    Subclasses must implement:
    - get_name() -> str
    - get_description() -> str
    - get_params_definition() -> Dict[str, ToolParamDefinition]
    - run_impl(**kwargs) -> Dict[str, Any]
    """

    def run(self, messages: List[CompletionMessage]) -> ToolResponse:
        """
        Handle tool invocation from Llama Stack.
        
        Synchronous method matching ClientTool signature.
        """
        message = messages[-1]
        assert isinstance(message, CompletionMessage), "Expected CompletionMessage"
        assert message.tool_calls is not None, "Expected tool_calls in message"
        assert len(message.tool_calls) == 1, "Expected single tool call"
        tool_call = message.tool_calls[0]

        tool_name = self.get_name()
        
        # Parse arguments
        if isinstance(tool_call.arguments, str):
            params = json.loads(tool_call.arguments)
        else:
            params = tool_call.arguments or {}

        logger.info("Tool '%s' invoked with args: %s", tool_name, params)

        try:
            result = self.run_impl(**params)
            content = json.dumps(result, ensure_ascii=False)
            logger.info("Tool '%s' completed successfully", tool_name)

        except httpx.HTTPStatusError as exc:
            logger.error("Tool '%s' HTTP error: %s", tool_name, exc)
            error_response = format_tool_error(
                error_type="http_error",
                message=f"HTTP {exc.response.status_code}: {exc.response.text[:200]}",
                details={"status_code": exc.response.status_code},
            )
            content = json.dumps(error_response, ensure_ascii=False)

        except httpx.ConnectError as exc:
            logger.error("Tool '%s' connection error: %s", tool_name, exc)
            error_response = format_tool_error(
                error_type="connection_error",
                message="Failed to connect to external service",
            )
            content = json.dumps(error_response, ensure_ascii=False)

        except httpx.TimeoutException as exc:
            logger.error("Tool '%s' timeout: %s", tool_name, exc)
            error_response = format_tool_error(
                error_type="timeout_error",
                message="Request to external service timed out",
            )
            content = json.dumps(error_response, ensure_ascii=False)

        except ValueError as exc:
            logger.error("Tool '%s' validation error: %s", tool_name, exc)
            error_response = format_tool_error(
                error_type="validation_error",
                message=str(exc),
            )
            content = json.dumps(error_response, ensure_ascii=False)

        except Exception as exc:
            logger.exception("Tool '%s' unexpected error: %s", tool_name, exc)
            error_response = format_tool_error(
                error_type="internal_error",
                message=str(exc),
            )
            content = json.dumps(error_response, ensure_ascii=False)

        return ToolResponse(
            call_id=tool_call.call_id,
            tool_name=tool_name,
            content=content,
            metadata={},
        )

    @abstractmethod
    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        """Return parameter definitions for the tool.
        
        Example:
            return {
                "query": ToolParamDefinition(
                    param_type="str",
                    description="Search query",
                    required=True,
                ),
            }
        """
        raise NotImplementedError("Subclasses must implement get_params_definition")

    @abstractmethod
    def run_impl(self, **kwargs) -> Dict[str, Any]:
        """Implement the tool's actual logic (synchronous)."""
        raise NotImplementedError("Subclasses must implement run_impl")
