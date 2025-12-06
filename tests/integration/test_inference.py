"""Integration tests for Llama Stack inference.

These tests require a running Llama Stack instance.
Skip in CI with: pytest -m "not integration"
"""

import pytest

from client import verify_connection, chat_completion, collect_stream


@pytest.mark.integration
def test_verify_connection_real():
    """Test connection to real Llama Stack instance."""
    result = verify_connection()

    assert result["models_available"] >= 0, "Should return model count"

    if not result["success"]:
        pytest.skip(f"Llama Stack not available: {result['error']}")

    assert result["inference_works"] is True


@pytest.mark.integration
def test_chat_completion_real():
    """Test real chat completion against Llama Stack."""
    conn = verify_connection()
    if not conn["success"]:
        pytest.skip(f"Llama Stack not available: {conn['error']}")

    response = chat_completion(
        messages=[{"role": "user", "content": "Say 'test passed' and nothing else."}],
    )

    assert response is not None
    assert len(response) > 0


@pytest.mark.integration
def test_chat_completion_streaming_real():
    """Test real streaming chat completion."""
    conn = verify_connection()
    if not conn["success"]:
        pytest.skip(f"Llama Stack not available: {conn['error']}")

    stream = chat_completion(
        messages=[{"role": "user", "content": "Count from 1 to 3."}],
        stream=True,
    )

    full_response = collect_stream(stream)
    assert len(full_response) > 0


@pytest.mark.integration
def test_chat_completion_with_system_message_real():
    """Test chat completion with system message."""
    conn = verify_connection()
    if not conn["success"]:
        pytest.skip(f"Llama Stack not available: {conn['error']}")

    response = chat_completion(
        messages=[{"role": "user", "content": "What is your role?"}],
        system_message="You are a helpful coding assistant. Always mention that you help with code.",
    )

    assert response is not None
