"""Integration tests for Llama Stack inference.

These tests require a running Llama Stack instance.
Skip in CI with: pytest -m "not integration"
"""

import pytest

from myloware.llama_clients import get_sync_client, verify_connection

# Real model calls; run manually in live lane (may incur costs depending on provider).
pytestmark = pytest.mark.live


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

    client = get_sync_client()
    response = client.chat.completions.create(
        model=conn["model_tested"],
        messages=[{"role": "user", "content": "Say 'test passed' and nothing else."}],
        stream=False,
    )
    content = response.choices[0].message.content if response.choices else ""

    assert content is not None
    assert len(content) > 0


@pytest.mark.integration
def test_chat_completion_streaming_real():
    """Test real streaming chat completion."""
    conn = verify_connection()
    if not conn["success"]:
        pytest.skip(f"Llama Stack not available: {conn['error']}")

    client = get_sync_client()
    stream = client.chat.completions.create(
        model=conn["model_tested"],
        messages=[{"role": "user", "content": "Count from 1 to 3."}],
        stream=True,
    )
    chunks = []
    for chunk in stream:
        if not getattr(chunk, "choices", None):
            continue
        delta = getattr(chunk.choices[0], "delta", None)
        text = getattr(delta, "content", None) if delta else None
        if text:
            chunks.append(text)
    full_response = "".join(chunks)
    assert len(full_response) > 0


@pytest.mark.integration
def test_chat_completion_with_system_message_real():
    """Test chat completion with system message."""
    conn = verify_connection()
    if not conn["success"]:
        pytest.skip(f"Llama Stack not available: {conn['error']}")

    client = get_sync_client()
    response = client.chat.completions.create(
        model=conn["model_tested"],
        messages=[
            {
                "role": "system",
                "content": "You are a helpful coding assistant. Always mention that you help with code.",
            },
            {"role": "user", "content": "What is your role?"},
        ],
        stream=False,
    )
    content = response.choices[0].message.content if response.choices else ""
    assert content is not None
