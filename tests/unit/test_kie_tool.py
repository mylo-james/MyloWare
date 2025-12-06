"""Unit tests for KIE video generation tool."""

from unittest.mock import Mock, patch

import httpx
import pytest

from tools.kie import KIEGenerationTool


def test_kie_tool_name():
    """Test tool returns correct name."""
    tool = KIEGenerationTool(use_fake=True)
    assert tool.get_name() == "kie_generate"


def test_kie_tool_description():
    """Test tool has meaningful description."""
    tool = KIEGenerationTool(use_fake=True)
    desc = tool.get_description()
    assert "video" in desc.lower()
    assert "prompt" in desc.lower()


def test_kie_tool_params():
    """Test tool parameter definitions."""
    tool = KIEGenerationTool(use_fake=True)
    params = tool.get_params_definition()

    # Check required parameters
    assert "videos" in params
    assert params["videos"].required is True
    assert params["videos"].param_type == "list"
    
    # Check optional parameters
    assert "aspect_ratio" in params
    assert params["aspect_ratio"].required is False
    assert "9:16" in str(params["aspect_ratio"].default)


def test_kie_tool_fake_mode():
    """Test fake mode returns simulated results."""
    tool = KIEGenerationTool(use_fake=True)

    result = tool.run_impl(prompts=["Test prompt"])

    assert result["success"] is True
    assert result["fake_mode"] is True
    assert len(result["task_ids"]) == 1
    assert result["status"] == "submitted"


def test_kie_tool_fake_mode_multiple():
    """Test fake mode with multiple prompts."""
    tool = KIEGenerationTool(use_fake=True)

    result = tool.run_impl(prompts=["Prompt 1", "Prompt 2", "Prompt 3"])

    assert result["task_count"] == 3
    assert len(result["task_ids"]) == 3


def test_kie_tool_submit_single_job():
    """Test submitting a single video generation job to real API."""
    mock_response = Mock()
    mock_response.json.return_value = {"code": 200, "data": {"taskId": "task-123"}}
    mock_response.raise_for_status = Mock()

    with (
        patch("tools.kie.settings") as mock_settings,
        patch("httpx.Client") as mock_client_class,
    ):
        mock_settings.webhook_base_url = "https://test.example.com"
        mock_client = Mock()
        mock_client.post = Mock(return_value=mock_response)
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=None)
        mock_client_class.return_value = mock_client

        tool = KIEGenerationTool(
            api_key="test-key",
            use_fake=False,
            run_id="test-run-123",
        )
        result = tool.run_impl(prompts=["Test prompt"])

    assert result["success"] is True
    assert result["task_ids"] == ["task-123"]
    assert result["status"] == "submitted"
    assert result["task_count"] == 1


def test_kie_tool_submit_multiple_jobs():
    """Test submitting multiple video generation jobs."""
    task_ids = ["task-1", "task-2", "task-3"]
    call_count = 0

    def mock_post(*args, **kwargs):
        nonlocal call_count
        response = Mock()
        response.json.return_value = {"code": 200, "data": {"taskId": task_ids[call_count]}}
        response.raise_for_status = Mock()
        call_count += 1
        return response

    with (
        patch("tools.kie.settings") as mock_settings,
        patch("httpx.Client") as mock_client_class,
    ):
        mock_settings.webhook_base_url = "https://test.example.com"
        mock_client = Mock()
        mock_client.post = mock_post
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=None)
        mock_client_class.return_value = mock_client

        tool = KIEGenerationTool(
            api_key="test-key",
            use_fake=False,
            run_id="test-run-123",
        )
        result = tool.run_impl(prompts=["Prompt 1", "Prompt 2", "Prompt 3"])

    assert result["task_count"] == 3
    assert result["task_ids"] == task_ids


def test_kie_tool_custom_parameters():
    """Test custom parameters are passed to API."""
    captured_payload = {}

    def capture_post(url, **kwargs):
        captured_payload.update(kwargs.get("json", {}))
        response = Mock()
        response.json.return_value = {"code": 200, "data": {"taskId": "task-123"}}
        response.raise_for_status = Mock()
        return response

    with (
        patch("tools.kie.settings") as mock_settings,
        patch("httpx.Client") as mock_client_class,
    ):
        mock_settings.webhook_base_url = "https://test.example.com"
        mock_client = Mock()
        mock_client.post = capture_post
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=None)
        mock_client_class.return_value = mock_client

        tool = KIEGenerationTool(
            api_key="test-key",
            use_fake=False,
            run_id="test-run-123",
        )
        tool.run_impl(
            prompts=["Test"],
            aspect_ratio="16:9",
        )

    assert captured_payload["aspectRatio"] == "16:9"


def test_kie_tool_handles_api_error():
    """Test that API errors are raised properly (wrapped in ValueError)."""
    mock_response = Mock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"

    with (
        patch("tools.kie.settings") as mock_settings,
        patch("httpx.Client") as mock_client_class,
    ):
        mock_settings.webhook_base_url = "https://test.example.com"
        mock_client = Mock()
        mock_client.post = Mock(
            side_effect=httpx.HTTPStatusError(
                "Server error",
                request=Mock(),
                response=mock_response,
            )
        )
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=None)
        mock_client_class.return_value = mock_client

        tool = KIEGenerationTool(
            api_key="test-key",
            use_fake=False,
            run_id="test-run-123",
        )
        # After refactoring, errors are collected and raised with details
        with pytest.raises(ValueError, match="Failed to submit any tasks"):
            tool.run_impl(prompts=["Test"])


def test_kie_tool_requires_api_key_when_not_fake():
    """Test that API key is required when not using fake mode."""
    with patch("tools.kie.settings") as mock_settings:
        mock_settings.kie_api_key = None
        mock_settings.use_fake_providers = False
        with pytest.raises(ValueError, match="API key required"):
            KIEGenerationTool(api_key=None, use_fake=False)
