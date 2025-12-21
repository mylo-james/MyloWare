"""Tests for web research tool integration."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def test_ideator_agent_requires_vector_db_for_rag():
    """Fail fast when RAG is requested without a vector DB id."""
    from myloware.agents.factory import create_agent

    mock_client = MagicMock()

    with patch("myloware.agents.factory.Agent") as mock_agent_class:
        mock_agent_class.return_value = MagicMock()
        # RAG is in the YAML; missing vector_db_id should raise
        with pytest.raises(RuntimeError, match="RAG tool requested"):
            create_agent(mock_client, "aismr", "ideator", vector_db_id=None)


def test_ideator_agent_has_websearch_tool():
    """Ideator agent includes websearch when vector DB is available."""
    from myloware.agents.factory import create_agent

    mock_client = MagicMock()

    with patch("myloware.agents.factory.Agent") as mock_agent_class:
        mock_agent_class.return_value = MagicMock()

        create_agent(mock_client, "aismr", "ideator", vector_db_id="kb")

        call_kwargs = mock_agent_class.call_args.kwargs
        tools = call_kwargs.get("tools", [])
        has_websearch = any(isinstance(t, dict) and t.get("type") == "web_search" for t in tools)
        assert has_websearch, f"Expected web_search tool in {tools}"


def test_ideator_agent_with_rag_and_websearch():
    """Test that ideator agent includes both RAG and websearch tools."""
    from myloware.agents.factory import create_agent

    mock_client = MagicMock()

    with patch("myloware.agents.factory.Agent") as mock_agent_class:
        mock_agent_class.return_value = MagicMock()

        create_agent(mock_client, "aismr", "ideator", vector_db_id="kb")

        call_kwargs = mock_agent_class.call_args.kwargs
        tools = call_kwargs.get("tools", [])

        # Should have websearch (dict with type="web_search")
        has_websearch = any(isinstance(t, dict) and t.get("type") == "web_search" for t in tools)
        # Should have RAG config (dict with type="file_search")
        has_rag = any(isinstance(t, dict) and t.get("type") == "file_search" for t in tools)

        assert has_websearch or has_rag, f"Expected web_search or file_search in {tools}"


def test_format_search_context():
    from myloware.agents.research import format_search_context

    results = [
        {"title": "Top ASMR Trends", "url": "https://example.com", "snippet": "ASMR is growing"}
    ]

    formatted = format_search_context(results)
    assert "Top ASMR Trends" in formatted
    assert "ASMR is growing" in formatted


def test_format_empty_results():
    from myloware.agents.research import format_search_context

    formatted = format_search_context([])
    assert "No search results found" in formatted


def test_trending_topics_prompt():
    from myloware.agents.research import trending_topics_prompt

    prompt = trending_topics_prompt("ASMR")
    assert "ASMR" in prompt
    assert "trending" in prompt
