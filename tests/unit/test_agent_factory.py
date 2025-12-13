"""Unit tests for agent factory."""

from unittest.mock import Mock, patch

import pytest

from agents.factory import (
    create_persona_agent,
    create_rag_tool_config,
)


def test_create_persona_agent_minimal():
    """Test creating agent with minimal required parameters."""
    mock_client = Mock()

    with patch("agents.factory.Agent") as mock_agent_class:
        mock_agent = Mock()
        mock_agent_class.return_value = mock_agent

        agent = create_persona_agent(
            client=mock_client,
            persona_name="test_persona",
            instructions="You are a test agent.",
        )

        mock_agent_class.assert_called_once()
        call_kwargs = mock_agent_class.call_args.kwargs

        assert call_kwargs["client"] == mock_client
        assert call_kwargs["instructions"] == "You are a test agent."
        assert call_kwargs["tools"] == []
        assert agent == mock_agent


def test_create_persona_agent_shields_not_passed_to_agent():
    """Test that shields are NOT passed to Agent (configured at server level)."""
    mock_client = Mock()

    with patch("agents.factory.Agent") as mock_agent_class:
        # Note: shields params are accepted by factory but not passed to Agent
        # The current llama_stack_client Agent class doesn't support shields
        create_persona_agent(
            client=mock_client,
            persona_name="test",
            instructions="Test instructions",
        )

        call_kwargs = mock_agent_class.call_args.kwargs
        # Shields are no longer passed to the Agent constructor
        # They are configured at the Llama Stack server level instead
        assert "input_shields" not in call_kwargs
        assert "output_shields" not in call_kwargs


def test_create_persona_agent_shield_params_accepted():
    """Test that shield params are accepted by factory even if not used."""
    mock_client = Mock()
    custom_shields = ["custom_shield"]

    with patch("agents.factory.Agent") as mock_agent_class:
        # Factory accepts these params for API compatibility, but doesn't use them
        create_persona_agent(
            client=mock_client,
            persona_name="test",
            instructions="Test",
            input_shields=custom_shields,
            output_shields=custom_shields,
        )

        call_kwargs = mock_agent_class.call_args.kwargs
        # Shields are not passed to Agent - configured at server level
        assert "input_shields" not in call_kwargs
        assert "output_shields" not in call_kwargs


def test_create_persona_agent_sampling_not_passed_to_agent():
    """Test that sampling_params is NOT passed to Agent (not supported)."""
    mock_client = Mock()

    with patch("agents.factory.Agent") as mock_agent_class:
        create_persona_agent(
            client=mock_client,
            persona_name="test",
            instructions="Test",
        )

        call_kwargs = mock_agent_class.call_args.kwargs
        # sampling_params is no longer passed to Agent constructor
        assert "sampling_params" not in call_kwargs


def test_create_persona_agent_with_tools():
    """Test creating agent with tools."""
    mock_client = Mock()
    mock_tool = {"name": "test_tool", "args": {}}

    with patch("agents.factory.Agent") as mock_agent_class:
        create_persona_agent(
            client=mock_client,
            persona_name="test",
            instructions="Test",
            tools=[mock_tool],
        )

        call_kwargs = mock_agent_class.call_args.kwargs
        assert call_kwargs["tools"] == [mock_tool]


def test_create_persona_agent_validates_persona_name():
    """Test that empty persona_name raises ValueError."""
    mock_client = Mock()

    with pytest.raises(ValueError, match="persona_name is required"):
        create_persona_agent(
            client=mock_client,
            persona_name="",
            instructions="Test",
        )


def test_create_persona_agent_validates_instructions():
    """Test that empty instructions raises ValueError."""
    mock_client = Mock()

    with pytest.raises(ValueError, match="instructions is required"):
        create_persona_agent(
            client=mock_client,
            persona_name="test",
            instructions="",
        )


def test_create_rag_tool_config_single_db():
    """Test RAG tool config with single DB ID."""
    config = create_rag_tool_config("my_kb")

    assert config["type"] == "file_search"
    assert config["vector_store_ids"] == ["my_kb"]


def test_create_rag_tool_config_multiple_dbs():
    """Test RAG tool config with multiple DB IDs."""
    config = create_rag_tool_config(["kb1", "kb2"])

    assert config["type"] == "file_search"
    assert config["vector_store_ids"] == ["kb1", "kb2"]
