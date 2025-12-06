"""Unit tests for Upload-post video publishing tool."""

from unittest.mock import Mock, patch

import httpx
import pytest

from tools.publish import UploadPostTool


def test_publish_tool_name():
    """Test tool returns correct name."""
    tool = UploadPostTool(use_fake=True)
    assert tool.get_name() == "upload_post"


def test_publish_tool_description():
    """Test tool has meaningful description."""
    tool = UploadPostTool(use_fake=True)
    desc = tool.get_description()
    assert "tiktok" in desc.lower() or "publish" in desc.lower()


def test_publish_tool_params():
    """Test tool parameter definitions."""
    tool = UploadPostTool(use_fake=True)
    params = tool.get_params_definition()

    assert "video_url" in params
    assert params["video_url"].required is True
    assert "caption" in params
    assert params["caption"].required is True
    assert "tags" in params
    assert params["tags"].required is False


def test_publish_tool_fake_mode():
    """Test fake mode returns simulated results."""
    tool = UploadPostTool(use_fake=True)

    result = tool.run_impl(
        video_url="https://example.com/video.mp4",
        caption="Test caption",
    )

    assert result["success"] is True
    assert result["fake_mode"] is True
    assert "published_url" in result
    assert result["platform"] == "tiktok"
    assert result["status"] == "published"


def test_publish_tool_with_tags():
    """Test fake mode with tags."""
    tool = UploadPostTool(use_fake=True)

    result = tool.run_impl(
        video_url="https://example.com/video.mp4",
        caption="Test caption",
        tags=["tag1", "tag2", "tag3"],
    )

    assert result["tags_used"] == ["tag1", "tag2", "tag3"]


def test_publish_tool_custom_account():
    """Test custom account ID is used."""
    tool = UploadPostTool(use_fake=True)

    result = tool.run_impl(
        video_url="https://example.com/video.mp4",
        caption="Test caption",
        account_id="CustomAccount",
    )

    assert result["account_id"] == "CustomAccount"
    assert "@customaccount" in result["published_url"]


def test_publish_tool_default_account():
    """Test default account ID is AISMR."""
    tool = UploadPostTool(use_fake=True)

    result = tool.run_impl(
        video_url="https://example.com/video.mp4",
        caption="Test caption",
    )

    assert result["account_id"] == "AISMR"


def test_publish_tool_real_api():
    """Test submitting to real API (background processing mode)."""
    tool = UploadPostTool(api_key="test-key", use_fake=False)

    # Upload-Post API returns request_id for background processing
    mock_response = Mock()
    mock_response.json.return_value = {
        "success": True,
        "request_id": "test-request-123",
        "message": "Upload initiated successfully",
        "total_platforms": 1,
    }
    mock_response.raise_for_status = Mock()

    with patch("httpx.Client") as mock_client_class:
        mock_client = Mock()
        mock_client.post = Mock(return_value=mock_response)
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=None)
        mock_client_class.return_value = mock_client

        result = tool.run_impl(
            video_url="https://example.com/video.mp4",
            caption="Test caption",
        )

    assert result["success"] is True
    assert result["request_id"] == "test-request-123"
    assert result["status"] == "processing"
    assert "status_url" in result


def test_publish_tool_handles_api_error():
    """Test that API errors are raised properly."""
    tool = UploadPostTool(api_key="test-key", use_fake=False)

    mock_response = Mock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"

    with patch("httpx.Client") as mock_client_class:
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

        with pytest.raises(httpx.HTTPStatusError):
            tool.run_impl(
                video_url="https://example.com/video.mp4",
                caption="Test caption",
            )


def test_publish_tool_requires_video_url():
    """Test that video_url is required."""
    tool = UploadPostTool(use_fake=True)

    with pytest.raises(ValueError, match="video_url"):
        tool.run_impl(video_url="", caption="Test caption")


def test_publish_tool_requires_caption():
    """Test that caption is required."""
    tool = UploadPostTool(use_fake=True)

    with pytest.raises(ValueError, match="caption"):
        tool.run_impl(video_url="https://example.com/video.mp4", caption="")


def test_publish_tool_requires_api_key_when_not_fake():
    """Test that API key is required when not using fake mode."""
    with patch("tools.publish.settings") as mock_settings:
        mock_settings.upload_post_api_key = None
        mock_settings.use_fake_providers = False
        with pytest.raises(ValueError, match="API key required"):
            UploadPostTool(api_key=None, use_fake=False)
