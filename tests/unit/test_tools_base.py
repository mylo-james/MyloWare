"""Unit tests for base tool module."""

from typing import Dict
from unittest.mock import Mock

import pytest
import httpx

from tools.base import (
    MylowareBaseTool,
    format_tool_error,
    format_tool_success,
    ToolParamDefinition,
)


def test_format_tool_error_basic():
    """Test basic error formatting."""
    result = format_tool_error("test_error", "Something went wrong")

    assert result["error"] is True
    assert result["error_type"] == "test_error"
    assert result["message"] == "Something went wrong"


def test_format_tool_error_with_details():
    """Test error formatting with details."""
    result = format_tool_error(
        "http_error",
        "API failed",
        details={"status_code": 500},
    )

    assert result["details"]["status_code"] == 500


def test_format_tool_success_basic():
    """Test basic success formatting."""
    result = format_tool_success({"job_id": "123"})

    assert result["success"] is True
    assert result["job_id"] == "123"


def test_format_tool_success_with_message():
    """Test success formatting with message."""
    result = format_tool_success({"job_id": "123"}, message="Job submitted")

    assert result["message"] == "Job submitted"


class TestTool(MylowareBaseTool):
    """Test implementation of MylowareBaseTool."""

    def get_name(self) -> str:
        return "test_tool"

    def get_description(self) -> str:
        return "A test tool"

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "input": ToolParamDefinition(
                param_type="str",
                description="Test input",
                required=True,
            ),
        }

    def run_impl(self, input: str) -> dict:
        return {"result": f"Processed: {input}"}


def test_tool_run_success():
    """Test successful tool execution via run_impl directly."""
    tool = TestTool()

    result = tool.run_impl(input="hello")

    assert result["result"] == "Processed: hello"


class ErrorTool(MylowareBaseTool):
    """Tool that raises an error."""

    def get_name(self) -> str:
        return "error_tool"

    def get_description(self) -> str:
        return "A tool that errors"

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {}

    def run_impl(self) -> dict:
        raise ValueError("Something went wrong")


def test_tool_handles_exception():
    """Test that exceptions are raised from run_impl."""
    tool = ErrorTool()

    with pytest.raises(ValueError, match="Something went wrong"):
        tool.run_impl()


class HTTPErrorTool(MylowareBaseTool):
    """Tool that raises HTTP error."""

    def get_name(self) -> str:
        return "http_error_tool"

    def get_description(self) -> str:
        return "A tool that has HTTP errors"

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {}

    def run_impl(self) -> dict:
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        raise httpx.HTTPStatusError(
            "Server error",
            request=Mock(),
            response=mock_response,
        )


def test_tool_handles_http_error():
    """Test that HTTP errors are raised from run_impl."""
    tool = HTTPErrorTool()

    with pytest.raises(httpx.HTTPStatusError):
        tool.run_impl()


def test_tool_params_definition():
    """Test that get_params_definition returns correct parameters."""
    tool = TestTool()
    params = tool.get_params_definition()

    assert "input" in params
    assert params["input"].param_type == "str"
    assert params["input"].required is True
    assert "Test input" in params["input"].description
