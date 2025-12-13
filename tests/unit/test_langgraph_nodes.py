"""Unit tests for LangGraph workflow nodes."""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from uuid import uuid4

from workflows.langgraph.nodes import ideation_node, ideation_approval_node


@pytest.fixture
def mock_state():
    """Create a mock workflow state."""
    return {
        "run_id": str(uuid4()),
        "project": "aismr",
        "brief": "Test brief",
        "vector_db_id": "test_db",
        "ideas_approved": False,
        "production_complete": False,
        "publish_approved": False,
        "status": "pending",
        "current_step": "ideation",
    }


@pytest.fixture
def mock_client():
    """Mock Llama Stack client."""
    client = Mock()
    return client


@pytest.fixture
def mock_agent():
    """Mock agent."""
    agent = Mock()
    agent.create_session.return_value = "session-123"
    agent.create_turn.return_value = Mock(choices=[Mock(message=Mock(content="Test ideas output"))])
    return agent


@pytest.mark.asyncio
@patch("workflows.langgraph.nodes.get_sync_client")
@patch("workflows.langgraph.nodes.create_agent")
@patch("workflows.langgraph.nodes.check_agent_output")
@patch("workflows.langgraph.nodes.extract_content")
async def test_ideation_node_success(
    mock_extract,
    mock_check,
    mock_create_agent,
    mock_client,
    mock_state,
    mock_agent,
):
    """Test ideation node successfully generates ideas."""
    # Setup mocks
    mock_extract.return_value = "Generated ideas text"
    mock_check.return_value = AsyncMock(return_value=Mock(safe=True))
    mock_create_agent.return_value = mock_agent
    mock_client.return_value = Mock()

    # Mock repositories
    mock_db_session = Mock()
    mock_db_session.commit = AsyncMock()
    mock_db_session.rollback = AsyncMock()
    mock_db_session.close = AsyncMock()
    mock_run_repo = Mock()
    mock_run_repo.get_async = AsyncMock(return_value=Mock(id=uuid4(), artifacts={}))
    mock_run_repo.add_artifact_async = AsyncMock()
    mock_run_repo.update_async = AsyncMock()
    mock_artifact_repo = Mock()
    mock_artifact_repo.create_async = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield mock_run_repo, mock_artifact_repo, mock_db_session

    with patch("workflows.langgraph.nodes._get_repositories_async", fake_repos):
        with patch("workflows.langgraph.nodes.agent_session") as mock_session_ctx:
            mock_session_ctx.return_value.__enter__.return_value = "session-123"
            mock_session_ctx.return_value.__exit__.return_value = None

            result = await ideation_node(mock_state)

            assert "ideas" in result
            assert result["ideas"] == "Generated ideas text"
            assert result["status"] == "awaiting_ideation_approval"


def test_ideation_approval_node_approved():
    """Test ideation approval node with approval."""
    state = {
        "run_id": str(uuid4()),
        "ideas": "Test ideas",
    }

    with patch("workflows.langgraph.nodes.interrupt") as mock_interrupt:
        mock_interrupt.return_value = {"approved": True, "comment": "Looks good"}

        result = ideation_approval_node(state)

        assert result["ideas_approved"] is True
        assert result["approval_comment"] == "Looks good"


def test_ideation_approval_node_rejected():
    """Test ideation approval node with rejection."""
    state = {
        "run_id": str(uuid4()),
        "ideas": "Test ideas",
    }

    with patch("workflows.langgraph.nodes.interrupt") as mock_interrupt:
        mock_interrupt.return_value = {"approved": False, "comment": "Not good enough"}

        result = ideation_approval_node(state)

        assert result["ideas_approved"] is False
        assert result["status"] == "rejected"
