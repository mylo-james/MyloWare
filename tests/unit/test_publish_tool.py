"""Unit tests for Upload-post video publishing tool."""

from unittest.mock import AsyncMock, Mock, patch
import pytest

from myloware.tools.publish import UploadPostTool


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
    """Test tool input schema."""
    tool = UploadPostTool(use_fake=True)
    schema = tool.get_input_schema()
    props = schema["properties"]
    required = set(schema["required"])

    assert "video_url" in props and "caption" in props
    assert "video_url" in required and "caption" in required
    assert "tags" in props


@pytest.mark.asyncio
async def test_publish_tool_fake_mode():
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


@pytest.mark.asyncio
async def test_publish_tool_with_tags():
    """Test fake mode with tags."""
    tool = UploadPostTool(use_fake=True)

    result = tool.run_impl(
        video_url="https://example.com/video.mp4",
        caption="Test caption",
        tags=["tag1", "tag2", "tag3"],
    )

    assert result["tags_used"] == ["tag1", "tag2", "tag3"]


@pytest.mark.asyncio
async def test_publish_tool_custom_account():
    """Test custom account ID is used."""
    tool = UploadPostTool(use_fake=True)

    result = tool.run_impl(
        video_url="https://example.com/video.mp4",
        caption="Test caption",
        account_id="CustomAccount",
    )

    assert result["account_id"] == "CustomAccount"
    assert "@customaccount" in result["published_url"]


@pytest.mark.asyncio
async def test_publish_tool_default_account():
    """Test default account ID is AISMR."""
    tool = UploadPostTool(use_fake=True)

    result = tool.run_impl(
        video_url="https://example.com/video.mp4",
        caption="Test caption",
    )

    assert result["account_id"] == "AISMR"


@pytest.mark.asyncio
async def test_publish_tool_real_api():
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

    with patch("httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        result = tool.run_impl(
            video_url="https://example.com/video.mp4",
            caption="Test caption",
        )

    assert result["success"] is True
    assert result["request_id"] == "test-request-123"
    assert result["status"] == "processing"
    assert "status_url" in result


@pytest.mark.asyncio
async def test_publish_tool_handles_api_error():
    """Test that API errors return a structured tool error."""
    tool = UploadPostTool(api_key="test-key", use_fake=False)

    mock_response = Mock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    mock_response.json = Mock(return_value={})

    with patch("httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        result = tool.run_impl(
            video_url="https://example.com/video.mp4",
            caption="Test caption",
        )

    assert result["error"] is True
    assert result["error_type"] == "http_error"
    assert result["details"]["status_code"] == 500


@pytest.mark.asyncio
async def test_publish_tool_requires_video_url():
    """Test that video_url is required."""
    tool = UploadPostTool(use_fake=True)

    with pytest.raises(ValueError, match="video_url"):
        tool.run_impl(video_url="", caption="Test caption")


@pytest.mark.asyncio
async def test_publish_tool_requires_caption():
    """Test that caption is required."""
    tool = UploadPostTool(use_fake=True)

    with pytest.raises(ValueError, match="caption"):
        tool.run_impl(video_url="https://example.com/video.mp4", caption="")


def test_publish_tool_requires_api_key_when_not_fake():
    """Test that API key is required when not using fake mode."""
    with patch("myloware.tools.publish.settings") as mock_settings:
        mock_settings.upload_post_api_key = None
        mock_settings.upload_post_provider = "real"
        with pytest.raises(ValueError, match="API key required"):
            UploadPostTool(api_key=None, use_fake=False)


def test_publish_tool_rejects_invalid_provider_setting():
    with patch("myloware.tools.publish.settings") as mock_settings:
        mock_settings.upload_post_provider = "nope"
        mock_settings.upload_post_api_key = "key"
        with pytest.raises(ValueError, match="Invalid UPLOAD_POST_PROVIDER"):
            UploadPostTool(use_fake=True)


def test_publish_tool_rejects_off_provider():
    with patch("myloware.tools.publish.settings") as mock_settings:
        mock_settings.upload_post_provider = "off"
        mock_settings.upload_post_api_key = "key"
        with pytest.raises(ValueError, match="disabled"):
            UploadPostTool(use_fake=None)


def test_publish_tool_validate_result_requires_published_url():
    tool = UploadPostTool(use_fake=True)
    with pytest.raises(ValueError, match="published_url"):
        tool._validate_result({"status": "success"})


def test_publish_tool_validate_result_requires_status_url_when_processing():
    tool = UploadPostTool(use_fake=True)
    with pytest.raises(ValueError, match="status_url"):
        tool._validate_result({"status": "processing"}, allow_processing=True)


@pytest.mark.asyncio
async def test_publish_tool_idempotent_existing_publish(monkeypatch):
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.models import ArtifactType, RunStatus
    from myloware.storage.repositories import ArtifactRepository, RunRepository
    from myloware.config import settings

    monkeypatch.setattr(settings, "upload_post_provider", "fake")

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        run_repo = RunRepository(session)
        art_repo = ArtifactRepository(session)
        run = await run_repo.create_async(
            workflow_name="motivational", input="x", status=RunStatus.PENDING
        )
        await session.commit()

        await art_repo.create_async(
            run_id=run.id,
            persona="publisher",
            artifact_type=ArtifactType.PUBLISHED_URL,
            uri="https://tiktok.com/@aismr/abc",
            metadata={
                "video_url": "https://cdn.example/v.mp4",
                "publish_id": "pub-1",
                "platform": "tiktok",
                "account_id": "AISMR",
            },
        )
        await session.commit()

    tool = UploadPostTool(run_id=str(run.id), use_fake=True)
    result = await tool.async_run_impl(
        video_url="https://cdn.example/v.mp4",
        caption="Hello",
    )
    assert result["idempotent"] is True
    assert result["published_url"] == "https://tiktok.com/@aismr/abc"


@pytest.mark.asyncio
async def test_publish_tool_stores_video_url_in_data(monkeypatch):
    async def fake_run(*_a, **_k):
        return {"data": {}}

    monkeypatch.setattr(UploadPostTool, "_run_fake", fake_run)
    tool = UploadPostTool(use_fake=True)
    result = await tool.async_run_impl(
        video_url="https://cdn.example/vid.mp4",
        caption="Test",
    )
    assert result["data"]["video_url"] == "https://cdn.example/vid.mp4"


@pytest.mark.asyncio
async def test_publish_tool_real_api_direct_url_and_tags():
    tool = UploadPostTool(api_key="test-key", use_fake=False)

    mock_response = Mock()
    mock_response.json.return_value = {"success": True, "url": "https://tiktok.com/@aismr/123"}
    mock_response.raise_for_status = Mock()

    with patch("httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        result = tool.run_impl(
            video_url="https://example.com/video.mp4",
            caption="Test caption",
            tags=["alpha", "beta"],
        )

    assert result["success"] is True
    assert result["published_url"] == "https://tiktok.com/@aismr/123"
    assert result["tags_used"] == ["alpha", "beta"]
