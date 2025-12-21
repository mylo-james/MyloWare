"""Tests for Telegram notification service."""

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_send_run_started():
    """Test run started notification format."""
    from myloware.notifications.telegram import TelegramNotifier

    notifier = TelegramNotifier(bot_token="test_token")

    with patch.object(notifier, "send_message", new_callable=AsyncMock) as mock_send:
        mock_send.return_value.success = True

        await notifier.send_run_started(
            chat_id="12345",
            run_id="abc-123",
            project="motivational",
        )

        mock_send.assert_called_once()
        call_text = mock_send.call_args[0][1]

        assert "Run Started" in call_text
        assert "motivational" in call_text
        assert "abc-123" in call_text


@pytest.mark.asyncio
async def test_send_hitl_request_has_buttons():
    """Test HITL request includes inline keyboard."""
    from myloware.notifications.telegram import TelegramNotifier

    notifier = TelegramNotifier(bot_token="test_token")

    with patch.object(notifier, "send_message", new_callable=AsyncMock) as mock_send:
        mock_send.return_value.success = True

        await notifier.send_hitl_request(
            chat_id="12345",
            run_id="abc-123",
            gate="ideation",
            content_preview="Some creative ideas here",
        )

        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args.kwargs

        assert "reply_markup" in call_kwargs
        buttons = call_kwargs["reply_markup"]["inline_keyboard"][0]
        assert len(buttons) == 2
        assert "Approve" in buttons[0]["text"]
        assert "Reject" in buttons[1]["text"]


@pytest.mark.asyncio
async def test_send_run_completed():
    """Test completion notification includes URL."""
    from myloware.notifications.telegram import TelegramNotifier

    notifier = TelegramNotifier(bot_token="test_token")

    with patch.object(notifier, "send_message", new_callable=AsyncMock) as mock_send:
        mock_send.return_value.success = True

        await notifier.send_run_completed(
            chat_id="12345",
            run_id="abc-123",
            published_url="https://tiktok.com/@aismr/video/123",
        )

        call_text = mock_send.call_args[0][1]

        assert "Completed" in call_text
        assert "tiktok.com" in call_text


@pytest.mark.asyncio
async def test_send_fails_without_token():
    """Notification fails gracefully without token."""
    from myloware.notifications.telegram import TelegramNotifier

    notifier = TelegramNotifier(bot_token="")

    result = await notifier.send_message("12345", "test")

    assert result.success is False
    assert "token" in (result.error or "").lower()


@pytest.mark.asyncio
async def test_content_preview_truncation():
    """Long content is truncated in HITL request."""
    from myloware.notifications.telegram import TelegramNotifier

    notifier = TelegramNotifier(bot_token="test_token")

    long_content = "x" * 1000

    with patch.object(notifier, "send_message", new_callable=AsyncMock) as mock_send:
        mock_send.return_value.success = True

        await notifier.send_hitl_request(
            chat_id="12345",
            run_id="abc-123",
            gate="ideation",
            content_preview=long_content,
        )

        call_text = mock_send.call_args[0][1]

        assert len(call_text) < 1000
        assert "..." in call_text
