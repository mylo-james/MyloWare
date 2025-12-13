"""Unit tests for Remotion render tool."""

from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest

from tools.remotion import RemotionRenderTool


def test_remotion_tool_name_and_schema():
    with patch("tools.remotion.settings") as mock_settings:
        mock_settings.remotion_provider = "fake"
        mock_settings.remotion_service_url = "http://localhost:3001"
        mock_settings.webhook_base_url = "http://example.com"
        tool = RemotionRenderTool()

    assert tool.get_name() == "remotion_render"
    schema = tool.get_input_schema()
    props = schema["properties"]
    required = set(schema.get("required", []))
    assert "composition_code" in props
    assert "clips" in props
    assert "clips" in required


@pytest.mark.asyncio
async def test_remotion_tool_fake_mode():
    with patch("tools.remotion.settings") as mock_settings:
        mock_settings.remotion_provider = "fake"
        mock_settings.remotion_service_url = "http://localhost:3001"
        mock_settings.webhook_base_url = "http://example.com"
        tool = RemotionRenderTool(run_id="run-123")

    result = tool.run_impl(
        composition_code="export const RemotionComposition = () => null;",
        clips=["https://example.com/clip.mp4"],
    )

    assert result["success"] is True
    assert result["status"] == "queued"
    assert "job_id" in result


@pytest.mark.asyncio
async def test_remotion_tool_submits_payload():
    captured = {}

    async def capture_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs.get("json", {}))
        response = Mock()
        response.json.return_value = {"job_id": "job-123", "status": "queued"}
        response.raise_for_status = Mock()
        return response

    with (
        patch("tools.remotion.settings") as mock_settings,
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        mock_settings.remotion_provider = "real"
        mock_settings.remotion_service_url = "http://render.local"
        mock_settings.webhook_base_url = "https://api.example.com"

        mock_client = AsyncMock()
        mock_client.post = capture_post
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        tool = RemotionRenderTool(run_id="abc")
        result = tool.run_impl(
            composition_code="export const RemotionComposition = () => null;",
            clips=["https://example.com/clip1.mp4"],
            duration_seconds=5,
            fps=30,
            aspect_ratio="9:16",
        )

    assert result["success"] is True
    assert captured["run_id"] == "abc"
    assert captured["callback_url"].startswith("https://api.example.com")
    assert captured["duration_frames"] == 150
    assert captured["width"] == 1080
    assert captured["height"] == 1920


@pytest.mark.asyncio
async def test_remotion_tool_requires_clips():
    with patch("tools.remotion.settings") as mock_settings:
        mock_settings.remotion_provider = "fake"
        mock_settings.remotion_service_url = "http://localhost:3001"
        mock_settings.webhook_base_url = "http://example.com"
        tool = RemotionRenderTool()

    with pytest.raises(ValueError):
        tool.run_impl(composition_code="export const RemotionComposition = () => null;", clips=[])


@pytest.mark.asyncio
async def test_remotion_tool_raises_http_error():
    with (
        patch("tools.remotion.settings") as mock_settings,
        patch("httpx.AsyncClient") as mock_client_cls,
    ):
        mock_settings.remotion_provider = "real"
        mock_settings.remotion_service_url = "http://render.local"
        mock_settings.webhook_base_url = "https://api.example.com"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "fail", request=Mock(), response=Mock(status_code=500, text="error")
            )
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        tool = RemotionRenderTool(run_id="abc")
        with pytest.raises(httpx.HTTPStatusError):
            tool.run_impl(
                composition_code="export const RemotionComposition = () => null;",
                clips=["https://example.com/clip1.mp4"],
            )
