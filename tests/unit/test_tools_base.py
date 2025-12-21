"""Unit tests for base tool module."""

from unittest.mock import Mock

import pytest
import httpx

from myloware.tools.base import (
    MylowareBaseTool,
    format_tool_error,
    format_tool_success,
    JSONSchema,
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

    def get_input_schema(self) -> JSONSchema:
        return {
            "type": "object",
            "properties": {
                "input": {
                    "type": "string",
                    "description": "Test input",
                }
            },
            "required": ["input"],
        }

    async def run_impl(self, input: str) -> dict:
        return {"result": f"Processed: {input}"}


@pytest.mark.asyncio
async def test_tool_run_success():
    """Test successful tool execution via run_impl directly."""
    tool = TestTool()

    result = await tool.run_impl(input="hello")

    assert result["result"] == "Processed: hello"


class ErrorTool(MylowareBaseTool):
    """Tool that raises an error."""

    def get_name(self) -> str:
        return "error_tool"

    def get_description(self) -> str:
        return "A tool that errors"

    def get_input_schema(self) -> JSONSchema:
        return {"type": "object", "properties": {}}

    async def run_impl(self) -> dict:
        raise ValueError("Something went wrong")


@pytest.mark.asyncio
async def test_tool_handles_exception():
    """Test that exceptions are raised from run_impl."""
    tool = ErrorTool()

    with pytest.raises(ValueError, match="Something went wrong"):
        await tool.run_impl()


class HTTPErrorTool(MylowareBaseTool):
    """Tool that raises HTTP error."""

    def get_name(self) -> str:
        return "http_error_tool"

    def get_description(self) -> str:
        return "A tool that has HTTP errors"

    def get_input_schema(self) -> JSONSchema:
        return {"type": "object", "properties": {}}

    async def run_impl(self) -> dict:
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        raise httpx.HTTPStatusError(
            "Server error",
            request=Mock(),
            response=mock_response,
        )


@pytest.mark.asyncio
async def test_tool_handles_http_error():
    """Test that HTTP errors are raised from run_impl."""
    tool = HTTPErrorTool()

    with pytest.raises(httpx.HTTPStatusError):
        await tool.run_impl()


def test_tool_input_schema():
    """Test that get_input_schema returns correct JSON schema."""
    tool = TestTool()
    schema = tool.get_input_schema()

    assert schema["type"] == "object"
    assert "input" in schema["properties"]
    assert "required" in schema and "input" in schema["required"]


class AsyncOnlyTool(MylowareBaseTool):
    def get_name(self) -> str:
        return "async_only"

    def get_description(self) -> str:
        return "Async-only tool"

    def get_input_schema(self) -> JSONSchema:
        return {"type": "object", "properties": {"value": {"type": "integer"}}}

    async def async_run_impl(self, value: int = 0) -> dict:
        return {"value": value}


class SyncOnlyTool(MylowareBaseTool):
    def get_name(self) -> str:
        return "sync_only"

    def get_description(self) -> str:
        return "Sync-only tool"

    def get_input_schema(self) -> JSONSchema:
        return {"type": "object", "properties": {"flag": {"type": "boolean"}}}

    def run_impl(self, flag: bool = False) -> dict:
        return {"flag": flag}


class NoImplTool(MylowareBaseTool):
    def get_name(self) -> str:
        return "no_impl"

    def get_description(self) -> str:
        return "No implementation"

    def get_input_schema(self) -> JSONSchema:
        return {"type": "object", "properties": {}}


def test_tool_run_delegates_to_client_tool(monkeypatch):
    from llama_stack_client.lib.agents.client_tool import ClientTool

    def fake_run(self, _message_history):  # type: ignore[no-untyped-def]
        return {"ok": True}

    monkeypatch.setattr(ClientTool, "run", fake_run)
    tool = TestTool()
    assert tool.run([]) == {"ok": True}


def test_tool_run_propagates_exceptions(monkeypatch):
    from llama_stack_client.lib.agents.client_tool import ClientTool

    def fake_run(self, _message_history):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr(ClientTool, "run", fake_run)
    tool = TestTool()
    with pytest.raises(RuntimeError, match="boom"):
        tool.run([])


def test_run_impl_uses_asyncio_run_when_no_loop():
    tool = AsyncOnlyTool()
    result = tool.run_impl(value=42)
    assert result == {"value": 42}


@pytest.mark.asyncio
async def test_run_impl_uses_thread_when_loop_running():
    tool = AsyncOnlyTool()
    result = tool.run_impl(value=7)
    assert result == {"value": 7}


def test_run_impl_requires_override():
    tool = NoImplTool()
    with pytest.raises(NotImplementedError):
        tool.run_impl()


@pytest.mark.asyncio
async def test_async_run_impl_falls_back_to_sync_run_impl():
    tool = SyncOnlyTool()
    result = await tool.async_run_impl(flag=True)
    assert result == {"flag": True}


@pytest.mark.asyncio
async def test_async_run_impl_propagates_not_implemented():
    tool = NoImplTool()
    with pytest.raises(NotImplementedError):
        await tool.async_run_impl()


def test_get_input_schema_base_raises_not_implemented():
    class BadSchemaTool(MylowareBaseTool):
        def get_name(self) -> str:
            return "bad_schema"

        def get_description(self) -> str:
            return "bad schema"

        def get_input_schema(self) -> JSONSchema:
            return super().get_input_schema()

    tool = BadSchemaTool()
    with pytest.raises(NotImplementedError):
        tool.get_input_schema()
