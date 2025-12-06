"""Unit tests for Llama Stack client."""

from unittest.mock import Mock, patch

import pytest

from client import (
    get_client,
    clear_client_cache,
    list_models,
    verify_connection,
    chat_completion,
    extract_content,
    extract_streaming_chunk,
    collect_stream,
    LlamaStackConnectionError,
)


def _make_mock_openai_response(content: str):
    """Create a mock OpenAI-style response."""
    mock_message = Mock()
    mock_message.content = content
    
    mock_choice = Mock()
    mock_choice.message = mock_message
    
    mock_response = Mock()
    mock_response.choices = [mock_choice]
    mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20}
    return mock_response


def _make_mock_streaming_chunk(content: str):
    """Create a mock OpenAI-style streaming chunk."""
    mock_delta = Mock()
    mock_delta.content = content
    
    mock_choice = Mock()
    mock_choice.delta = mock_delta
    
    mock_chunk = Mock()
    mock_chunk.choices = [mock_choice]
    return mock_chunk


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear client cache before and after each test."""
    clear_client_cache()
    yield
    clear_client_cache()


def test_get_client_creates_client():
    """Test that get_client creates a LlamaStackClient."""
    with patch("client.LlamaStackClient") as mock_client_class:
        mock_client = Mock()
        mock_client_class.return_value = mock_client

        client = get_client()

        mock_client_class.assert_called_once()
        assert client == mock_client


def test_get_client_uses_cache():
    """Test that get_client returns cached instance."""
    with patch("client.LlamaStackClient") as mock_client_class:
        mock_client = Mock()
        mock_client_class.return_value = mock_client

        client1 = get_client()
        client2 = get_client()

        assert mock_client_class.call_count == 1
        assert client1 is client2


def test_list_models_returns_model_ids():
    """Test that list_models returns model identifiers."""
    mock_model1 = Mock()
    mock_model1.identifier = "model-1"
    mock_model2 = Mock()
    mock_model2.identifier = "model-2"

    mock_client = Mock()
    mock_client.models.list.return_value = [mock_model1, mock_model2]

    models = list_models(client=mock_client)

    assert models == ["model-1", "model-2"]


def test_list_models_handles_empty():
    """Test list_models with no models available."""
    mock_client = Mock()
    mock_client.models.list.return_value = []

    models = list_models(client=mock_client)

    assert models == []


def test_list_models_raises_on_error():
    """Test that list_models raises LlamaStackConnectionError on failure."""
    mock_client = Mock()
    mock_client.models.list.side_effect = Exception("Connection refused")

    with pytest.raises(LlamaStackConnectionError) as exc_info:
        list_models(client=mock_client)

    assert "Connection refused" in str(exc_info.value.cause)


def test_verify_connection_success():
    """Test successful connection verification."""
    mock_model = Mock()
    mock_model.identifier = "test-model"

    mock_response = _make_mock_openai_response("hello")

    mock_client = Mock()
    mock_client.models.list.return_value = [mock_model]
    mock_client.chat.completions.create.return_value = mock_response

    result = verify_connection(client=mock_client)

    assert result["success"] is True
    assert result["models_available"] == 1
    assert result["inference_works"] is True
    assert result["model_tested"] == "test-model"


def test_verify_connection_no_models():
    """Test verify_connection when no models available."""
    mock_client = Mock()
    mock_client.models.list.return_value = []

    result = verify_connection(client=mock_client)

    assert result["success"] is False
    assert result["error"] == "No models available"


def test_extract_content_from_openai_response():
    """Test extracting content from OpenAI-style response with choices."""
    mock_response = _make_mock_openai_response("Hello world")

    content = extract_content(mock_response)

    assert content == "Hello world"


def test_extract_content_from_legacy_completion_message():
    """Test extracting content from legacy completion_message format."""
    mock_response = Mock()
    mock_response.choices = []  # Empty choices to skip OpenAI path
    mock_response.completion_message = Mock()
    mock_response.completion_message.content = "Hello legacy"

    content = extract_content(mock_response)

    assert content == "Hello legacy"


def test_extract_content_from_dict():
    """Test extracting content from dict response."""
    response = {"completion_message": {"content": "Hello from dict"}}

    content = extract_content(response)

    assert content == "Hello from dict"


def test_extract_content_from_openai_dict():
    """Test extracting content from OpenAI-style dict response."""
    response = {"choices": [{"message": {"content": "Hello from OpenAI dict"}}]}

    content = extract_content(response)

    assert content == "Hello from OpenAI dict"


def test_extract_content_handles_none():
    """Test that extract_content handles None gracefully."""
    assert extract_content(None) == ""


def test_extract_streaming_chunk_from_openai_format():
    """Test extracting chunk from OpenAI-style streaming format."""
    mock_chunk = _make_mock_streaming_chunk("Hello")

    content = extract_streaming_chunk(mock_chunk)

    assert content == "Hello"


def test_extract_streaming_chunk_from_legacy_event():
    """Test extracting chunk from legacy event.delta format."""
    mock_chunk = Mock()
    mock_chunk.choices = []  # Empty to skip OpenAI path
    mock_chunk.event = Mock()
    mock_chunk.event.delta = "Hello legacy"

    content = extract_streaming_chunk(mock_chunk)

    assert content == "Hello legacy"


def test_extract_streaming_chunk_handles_none():
    """Test that None chunks return None."""
    assert extract_streaming_chunk(None) is None


def test_chat_completion_non_streaming():
    """Test non-streaming chat completion."""
    mock_response = _make_mock_openai_response("Test response")

    mock_client = Mock()
    mock_client.chat.completions.create.return_value = mock_response

    result = chat_completion(
        messages=[{"role": "user", "content": "Test"}],
        client=mock_client,
    )

    assert result == "Test response"


def test_chat_completion_with_system_message():
    """Test that system message is prepended."""
    mock_response = _make_mock_openai_response("Response")

    mock_client = Mock()
    mock_client.chat.completions.create.return_value = mock_response

    chat_completion(
        messages=[{"role": "user", "content": "Hi"}],
        system_message="You are helpful",
        client=mock_client,
    )

    call_args = mock_client.chat.completions.create.call_args
    messages = call_args.kwargs["messages"]
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == "You are helpful"


def test_collect_stream():
    """Test collecting streaming chunks."""

    def mock_stream():
        yield "Hello"
        yield " "
        yield "world"

    result = collect_stream(mock_stream())

    assert result == "Hello world"
