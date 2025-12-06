"""Tests for request classification.

Note: The classifier uses LLM inference and requires a running Llama Stack server.
Unit tests mock the client, integration tests hit the real server.
"""

import pytest
from unittest.mock import MagicMock


def _make_mock_response(content: str):
    """Create a mock OpenAI-style response."""
    mock_message = MagicMock()
    mock_message.content = content
    
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


def _make_mock_client(response_content: str | None = None, raise_error: Exception | None = None):
    """Create a mock client with the new OpenAI-style API."""
    mock_client = MagicMock()
    
    if raise_error:
        mock_client.chat.completions.create.side_effect = raise_error
    elif response_content is not None:
        mock_client.chat.completions.create.return_value = _make_mock_response(response_content)
    
    return mock_client


class TestLLMClassifier:
    """Tests for LLM-based classifier (mocked)."""

    def test_classify_start_run(self):
        """Test classification of start_run intent."""
        from agents.classifier import classify_request

        mock_client = _make_mock_client(
            '{"intent": "start_run", "project": "test_video_gen", "confidence": 0.95}'
        )

        result = classify_request(mock_client, "run a test video")

        assert result.intent == "start_run"
        assert result.project == "test_video_gen"
        assert result.confidence == 0.95

    def test_classify_check_status(self):
        """Test classification of check_status intent."""
        from agents.classifier import classify_request

        mock_client = _make_mock_client(
            '{"intent": "check_status", "run_id": "abc-123", "confidence": 0.9}'
        )

        result = classify_request(mock_client, "what's the status of abc-123")

        assert result.intent == "check_status"
        assert result.run_id == "abc-123"

    def test_classify_approve_gate(self):
        """Test classification of approve_gate intent."""
        from agents.classifier import classify_request

        mock_client = _make_mock_client(
            '{"intent": "approve_gate", "gate": "ideation", "confidence": 0.88}'
        )

        result = classify_request(mock_client, "approve ideation")

        assert result.intent == "approve_gate"
        assert result.gate == "ideation"

    def test_classify_aismr_project(self):
        """Test classification detects aismr project."""
        from agents.classifier import classify_request

        mock_client = _make_mock_client(
            '{"intent": "start_run", "project": "aismr", "custom_object": "candles", "confidence": 0.92}'
        )

        result = classify_request(mock_client, "make an asmr video about candles")

        assert result.intent == "start_run"
        assert result.project == "aismr"
        assert result.custom_object == "candles"

    def test_classify_fails_fast_on_no_choices(self):
        """Test that classifier fails fast when LLM returns no choices."""
        from agents.classifier import classify_request

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = []  # Empty choices
        mock_client.chat.completions.create.return_value = mock_response

        with pytest.raises(RuntimeError, match="no choices"):
            classify_request(mock_client, "test message")

    def test_classify_fails_fast_on_empty_content(self):
        """Test that classifier fails fast when LLM returns empty content."""
        from agents.classifier import classify_request

        mock_client = _make_mock_client("")  # Empty content

        with pytest.raises(RuntimeError, match="empty content"):
            classify_request(mock_client, "test message")

    def test_classify_fails_fast_on_invalid_json(self):
        """Test that classifier fails fast when LLM returns invalid JSON."""
        from agents.classifier import classify_request

        mock_client = _make_mock_client("not valid json")

        with pytest.raises(Exception):  # json.JSONDecodeError
            classify_request(mock_client, "test message")

    def test_classify_fails_fast_on_api_error(self):
        """Test that classifier fails fast when Llama Stack API fails."""
        from agents.classifier import classify_request

        mock_client = _make_mock_client(raise_error=Exception("API unavailable"))

        with pytest.raises(Exception, match="API unavailable"):
            classify_request(mock_client, "test message")


@pytest.mark.asyncio
@pytest.mark.integration
async def test_llm_classifier_integration():
    """Test LLM-based classification with real Llama Stack server."""
    pytest.skip("Requires running Llama Stack server")

    from client import get_client
    from agents.classifier import classify_request

    client = get_client()

    result = classify_request(client, "run a test video")

    assert result.intent == "start_run"
    assert result.project == "test_video_gen"
    assert result.confidence > 0.7
