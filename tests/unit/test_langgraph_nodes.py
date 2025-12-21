"""Unit tests for LangGraph workflow nodes."""

import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from myloware.storage.models import ArtifactType, RunStatus
from myloware.workflows.langgraph import nodes

from myloware.workflows.langgraph.nodes import ideation_approval_node, ideation_node


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
    agent.create_turn.return_value = Mock(
        choices=[Mock(message=Mock(content="Test ideas output"))],
        steps=[],
        result=None,
        tool_responses=[],
    )
    return agent


@pytest.mark.asyncio
@patch("myloware.workflows.langgraph.nodes.get_sync_client")
@patch("myloware.workflows.langgraph.nodes.create_agent")
@patch("myloware.workflows.langgraph.nodes.check_agent_output")
@patch("myloware.workflows.langgraph.nodes.extract_content")
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

    with patch("myloware.workflows.langgraph.nodes._get_repositories_async", fake_repos):
        with patch("myloware.workflows.langgraph.nodes.agent_session") as mock_session_ctx:
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

    with patch("myloware.workflows.langgraph.nodes.interrupt") as mock_interrupt:
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

    with patch("myloware.workflows.langgraph.nodes.interrupt") as mock_interrupt:
        mock_interrupt.return_value = {"approved": False, "comment": "Not good enough"}

        result = ideation_approval_node(state)

        assert result["ideas_approved"] is False
        assert result["status"] == "rejected"


class FakeArtifact:
    def __init__(
        self,
        artifact_type: str,
        uri: str | None = None,
        artifact_metadata: dict[str, object] | None = None,
        content: str | None = None,
    ) -> None:
        self.artifact_type = artifact_type
        self.uri = uri
        self.artifact_metadata = artifact_metadata or {}
        self.content = content
        self.created_at = datetime.utcnow()


class FakeRun:
    def __init__(self, run_id, artifacts=None):
        self.id = run_id
        self.artifacts = artifacts or {}
        self.status = RunStatus.PENDING.value
        self.current_step = None
        self.error = None


@pytest.mark.asyncio
async def test_production_node_rejects_without_approval():
    state = {
        "run_id": str(uuid4()),
        "project": "aismr",
        "ideas_approved": False,
    }
    result = await nodes.production_node(state)
    assert result["status"] == RunStatus.REJECTED.value


@pytest.mark.asyncio
async def test_production_node_fake_success(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "ideas_approved": True,
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea text"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()
    run_repo.add_artifact_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)

    result = await nodes.production_node(state)
    assert result["production_complete"] is True
    assert len(result["video_clips"]) == 2
    assert result["current_step"] == "editing"
    assert artifact_repo.create_async.await_count >= 3


@pytest.mark.asyncio
async def test_production_node_no_ideas(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "ideas_approved": True,
    }

    run = FakeRun(run_id, artifacts={})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    artifact_repo = Mock()
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())

    result = await nodes.production_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "No ideas" in result["error"]


@pytest.mark.asyncio
async def test_wait_for_videos_node_returns_interrupt_when_missing_urls(monkeypatch):
    run_id = str(uuid4())
    state = {"run_id": run_id}
    interrupt_calls = []

    def fake_interrupt(payload):  # type: ignore[no-untyped-def]
        interrupt_calls.append(payload)
        if len(interrupt_calls) == 1:
            return {}
        return {"waiting": True}

    monkeypatch.setattr(nodes, "interrupt", fake_interrupt)
    result = await nodes.wait_for_videos_node(state)
    assert result == {"waiting": True}


@pytest.mark.asyncio
async def test_wait_for_videos_node_returns_clips(monkeypatch):
    run_id = str(uuid4())
    state = {"run_id": run_id}
    monkeypatch.setattr(nodes, "interrupt", lambda _p: {"video_urls": ["u1", "u2"]})

    result = await nodes.wait_for_videos_node(state)
    assert result["video_clips"] == ["u1", "u2"]
    assert result["current_step"] == "editing"


@pytest.mark.asyncio
async def test_wait_for_render_node_returns_interrupt_when_missing_url(monkeypatch):
    run_id = str(uuid4())
    state = {"run_id": run_id}
    interrupt_calls = []

    def fake_interrupt(payload):  # type: ignore[no-untyped-def]
        interrupt_calls.append(payload)
        if len(interrupt_calls) == 1:
            return {}
        return {"waiting": True}

    monkeypatch.setattr(nodes, "interrupt", fake_interrupt)
    result = await nodes.wait_for_render_node(state)
    assert result == {"waiting": True}


@pytest.mark.asyncio
async def test_wait_for_render_node_returns_video_url(monkeypatch):
    run_id = str(uuid4())
    state = {"run_id": run_id}
    monkeypatch.setattr(nodes, "interrupt", lambda _p: {"video_url": "https://cdn/final.mp4"})

    result = await nodes.wait_for_render_node(state)
    assert result["final_video_url"] == "https://cdn/final.mp4"
    assert result["current_step"] == "publish_approval"


@pytest.mark.asyncio
async def test_publish_approval_node_auto_approves_in_fake_mode(monkeypatch):
    run_id = str(uuid4())
    state = {"run_id": run_id}
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)

    result = await nodes.publish_approval_node(state)
    assert result["publish_approved"] is True
    assert result["current_step"] == "publishing"


@pytest.mark.asyncio
async def test_publish_approval_node_rejects(monkeypatch):
    run_id = str(uuid4())
    state = {"run_id": run_id}
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes, "interrupt", lambda _p: {"approved": False, "comment": "no"})

    result = await nodes.publish_approval_node(state)
    assert result["publish_approved"] is False
    assert result["status"] == RunStatus.REJECTED.value


@pytest.mark.asyncio
async def test_editing_node_fake_mode_returns_final_url(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "video_clips": ["https://clip.mp4"],
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea text"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.get_by_run_async = AsyncMock(
        return_value=[
            FakeArtifact(
                ArtifactType.VIDEO_CLIP.value,
                uri="https://clip.mp4",
                artifact_metadata={"topic": "t"},
            )
        ]
    )
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    async def fake_resolve(url: str) -> str:
        return url

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)
    monkeypatch.setattr("myloware.storage.object_store.resolve_s3_uri_async", fake_resolve)
    monkeypatch.setattr(
        "myloware.config.projects.load_project",
        lambda _p: SimpleNamespace(specs=SimpleNamespace(compilation_length=30)),
    )
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_editor_prompt", lambda **_k: "prompt"
    )

    result = await nodes.editing_node(state)
    assert result["current_step"] == "publish_approval"
    assert "final_video_url" in result
    assert artifact_repo.create_async.await_count >= 2


@pytest.mark.asyncio
async def test_editing_node_real_mode_requires_remotion_tool(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "video_clips": ["https://clip.mp4"],
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea text"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)

    artifact_repo = Mock()
    artifact_repo.get_by_run_async = AsyncMock(
        return_value=[
            FakeArtifact(
                ArtifactType.VIDEO_CLIP.value,
                uri="https://clip.mp4",
                artifact_metadata={"topic": "t"},
            )
        ]
    )
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    async def fake_resolve(url: str) -> str:
        return url

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr("myloware.storage.object_store.resolve_s3_uri_async", fake_resolve)
    monkeypatch.setattr(
        "myloware.config.projects.load_project",
        lambda _p: SimpleNamespace(specs=SimpleNamespace(compilation_length=30)),
    )
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_editor_prompt", lambda **_k: "prompt"
    )

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), []

    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    result = await nodes.editing_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "remotion_render" in result["error"]


@pytest.mark.asyncio
async def test_publishing_node_fake_mode_returns_published_url(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "topic"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.COMPLETED.value
    assert result["published_urls"][0].startswith("https://tiktok.com/@fake/")


@pytest.mark.asyncio
async def test_publishing_node_real_mode_requires_upload_post(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "topic"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)

    artifact_repo = Mock()
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt", lambda **_k: "prompt"
    )

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), []

    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "upload_post" in result["error"]


def test_run_guard_calls_safety_when_real(monkeypatch):
    client = SimpleNamespace(safety=SimpleNamespace(run_shield=Mock()))
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")

    nodes._run_guard(client, "hi")
    client.safety.run_shield.assert_called_once()


def test_run_guard_skips_when_disabled(monkeypatch):
    client = SimpleNamespace(safety=SimpleNamespace(run_shield=Mock()))
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")

    nodes._run_guard(client, "hi")
    client.safety.run_shield.assert_not_called()


def test_extract_upload_post_status_variants():
    assert nodes._extract_upload_post_status({"status": "Completed"}) == "completed"
    assert nodes._extract_upload_post_status({"state": "FAILED"}) == "failed"
    assert nodes._extract_upload_post_status({"processing_status": "Running"}) == "running"
    assert nodes._extract_upload_post_status({"result": "Done"}) == "done"


def test_extract_upload_post_urls_nested_and_dedup():
    payload = {
        "results": [
            {"post_url": "https://tiktok.com/1"},
            {"response": {"url": "https://tiktok.com/1"}},
        ],
        "data": {"link": "https://tiktok.com/2"},
    }
    urls = nodes._extract_upload_post_urls(payload)
    assert set(urls) == {"https://tiktok.com/1", "https://tiktok.com/2"}


@pytest.mark.asyncio
async def test_publishing_node_real_mode_immediate_publish(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "topic"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [
        {
            "tool_name": "upload_post",
            "content": {"data": {"published_url": "https://tiktok.com/ok", "platform": "tiktok"}},
        }
    ]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), tool_payloads

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt", lambda **_k: "prompt"
    )
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.COMPLETED.value
    assert result["published_urls"] == ["https://tiktok.com/ok"]


@pytest.mark.asyncio
async def test_publishing_node_real_mode_polls_status_url(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "topic"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [
        {
            "tool_name": "upload_post",
            "content": {"data": {"status_url": "https://status", "request_id": "req"}},
        }
    ]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), tool_payloads

    monkeypatch.setattr(
        nodes, "_poll_upload_post_status", AsyncMock(return_value=(["https://pub"], None, {}))
    )
    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt", lambda **_k: "prompt"
    )
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.COMPLETED.value
    assert result["published_urls"] == ["https://pub"]


@pytest.mark.asyncio
async def test_publishing_node_real_mode_poll_error(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "topic"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [
        {
            "tool_name": "upload_post",
            "content": {"data": {"status_url": "https://status", "request_id": "req"}},
        }
    ]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), tool_payloads

    monkeypatch.setattr(
        nodes, "_poll_upload_post_status", AsyncMock(return_value=([], "failed", {}))
    )
    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt", lambda **_k: "prompt"
    )
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "publish_status_url" in result


@pytest.mark.asyncio
async def test_publishing_node_input_safety_failure(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)

    artifact_repo = Mock()
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=False, reason="no"))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt", lambda **_k: "prompt"
    )

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_ideation_node_requires_run_id() -> None:
    with pytest.raises(ValueError):
        await nodes.ideation_node({})


@pytest.mark.asyncio
async def test_ideation_node_run_not_found_uses_thread_id(monkeypatch):
    run_id = uuid4()
    state = {"project": "aismr", "brief": "b"}

    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=None)
    artifact_repo = Mock()
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())

    async def fake_sleep(_t):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    result = await nodes.ideation_node(state, config={"configurable": {"thread_id": str(run_id)}})
    assert result["status"] == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_ideation_node_input_safety_failure(monkeypatch):
    run_id = uuid4()
    state = {"run_id": str(run_id), "project": "aismr", "brief": "b"}

    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=SimpleNamespace())
    artifact_repo = Mock()
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=False, reason="no"))
    )

    result = await nodes.ideation_node(state)
    assert result["status"] == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_production_node_tool_execution_error(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "ideas_approved": True,
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()
    run_repo.add_artifact_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()
    artifact_repo.get_by_run_async = AsyncMock(return_value=[])

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [{"tool_name": "sora_generate", "content": "Error when running tool: boom"}]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), tool_payloads

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    async def fake_run_sync(fn, *a, **k):  # type: ignore[no-untyped-def]
        return fn(*a, **k)

    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)

    result = await nodes.production_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "Failed to submit" in result["error"]


@pytest.mark.asyncio
async def test_production_node_missing_tool_execution(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "ideas_approved": True,
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()
    run_repo.add_artifact_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()
    artifact_repo.get_by_run_async = AsyncMock(return_value=[])

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), []

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    async def fake_run_sync(fn, *a, **k):  # type: ignore[no-untyped-def]
        return fn(*a, **k)

    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)

    result = await nodes.production_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "sora_generate" in result["error"]


@pytest.mark.asyncio
async def test_publishing_node_output_safety_failure(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "topic"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [
        {"tool_name": "upload_post", "content": '{"data": {"published_url": "https://pub"}}'}
    ]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), tool_payloads

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes,
        "check_agent_output",
        AsyncMock(return_value=SimpleNamespace(safe=False, reason="bad")),
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt", lambda **_k: "prompt"
    )
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_publishing_node_request_id_builds_status_url(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://cdn/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "topic"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [{"tool_name": "upload_post", "content": {"data": {"request_id": "req"}}}]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(output_text="out", steps=[], result=None), tool_payloads

    monkeypatch.setattr(
        nodes, "_poll_upload_post_status", AsyncMock(return_value=(["https://pub"], None, {}))
    )
    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt", lambda **_k: "prompt"
    )
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "out")
    monkeypatch.setattr(nodes.settings, "upload_post_api_url", "https://uploadpost")

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.COMPLETED.value


@pytest.mark.asyncio
async def test_wait_for_videos_node_returns_urls(monkeypatch):
    state = {"run_id": str(uuid4())}
    monkeypatch.setattr(nodes, "interrupt", lambda _payload: {"video_urls": ["a.mp4", "b.mp4"]})
    result = await nodes.wait_for_videos_node(state)
    assert result["production_complete"] is True
    assert result["video_clips"] == ["a.mp4", "b.mp4"]


@pytest.mark.asyncio
async def test_wait_for_videos_node_reinterrupts(monkeypatch):
    state = {"run_id": str(uuid4())}
    calls = []

    def fake_interrupt(payload):
        calls.append(payload)
        if len(calls) == 1:
            return {}
        return {"waiting_for": "sora_webhook"}

    monkeypatch.setattr(nodes, "interrupt", fake_interrupt)
    result = await nodes.wait_for_videos_node(state)
    assert result == {"waiting_for": "sora_webhook"}
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_editing_node_requires_clips():
    state = {"run_id": str(uuid4()), "project": "aismr", "video_clips": []}
    result = await nodes.editing_node(state)
    assert result["status"] == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_editing_node_fake_success(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "video_clips": ["https://example.com/1.mp4"],
    }

    run = FakeRun(run_id, artifacts={"ideas": "creative", "overlays": []})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.get_by_run_async = AsyncMock(
        return_value=[
            FakeArtifact(
                artifact_type=ArtifactType.VIDEO_CLIP.value,
                uri="https://example.com/1.mp4",
                artifact_metadata={"video_index": 0, "object_name": "obj"},
            )
        ]
    )
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class FakeSpecs:
        compilation_length = 8

    class FakeProject:
        specs = FakeSpecs()

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)
    monkeypatch.setattr(nodes, "sorted_video_clip_artifacts", lambda artifacts: artifacts)
    monkeypatch.setattr(
        "myloware.storage.object_store.resolve_s3_uri_async",
        AsyncMock(side_effect=lambda url: url),
    )
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _p: FakeProject())
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_editor_prompt",
        lambda **_kwargs: "editor prompt",
    )

    result = await nodes.editing_node(state)
    assert result["current_step"] == "publish_approval"
    assert result["final_video_url"].startswith("https://fake.remotion.com/")


@pytest.mark.asyncio
async def test_wait_for_render_node_returns_url(monkeypatch):
    state = {"run_id": str(uuid4())}
    monkeypatch.setattr(nodes, "interrupt", lambda _payload: {"video_url": "final.mp4"})
    result = await nodes.wait_for_render_node(state)
    assert result["final_video_url"] == "final.mp4"
    assert result["current_step"] == "publish_approval"


@pytest.mark.asyncio
async def test_wait_for_render_node_reinterrupts(monkeypatch):
    state = {"run_id": str(uuid4())}
    calls = []

    def fake_interrupt(payload):
        calls.append(payload)
        if len(calls) == 1:
            return {}
        return {"waiting_for": "remotion_webhook"}

    monkeypatch.setattr(nodes, "interrupt", fake_interrupt)
    result = await nodes.wait_for_render_node(state)
    assert result == {"waiting_for": "remotion_webhook"}
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_publish_approval_node_auto_approve(monkeypatch):
    state = {"run_id": str(uuid4())}
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)
    result = await nodes.publish_approval_node(state)
    assert result["publish_approved"] is True
    assert result["current_step"] == "publishing"


@pytest.mark.asyncio
async def test_publish_approval_node_interrupt(monkeypatch):
    state = {"run_id": str(uuid4()), "final_video_url": "final.mp4"}
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes, "interrupt", lambda _payload: {"approved": True, "comment": "ok"})
    result = await nodes.publish_approval_node(state)
    assert result["publish_approved"] is True
    assert result["approval_comment"] == "ok"


@pytest.mark.asyncio
async def test_publishing_node_requires_approval():
    state = {"run_id": str(uuid4()), "publish_approved": False}
    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.REJECTED.value


@pytest.mark.asyncio
async def test_publishing_node_requires_video():
    state = {"run_id": str(uuid4()), "publish_approved": True}
    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_publishing_node_fake_success(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://example.com/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "zodiac"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.COMPLETED.value
    assert result["current_step"] == "completed"
    assert result["published_urls"]


@pytest.mark.asyncio
async def test_production_node_real_mode_with_tool_payloads(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "ideas_approved": True,
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea text"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()
    run_repo.add_artifact_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager, contextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    @contextmanager
    def fake_agent_session(_client, _agent, _name):
        yield "session"

    async def fake_run_sync(func, *args, **kwargs):
        return func(*args, **kwargs)

    def fake_turn(*_args, **_kwargs):
        response = Mock()
        tool_payloads = [
            {"tool_name": "sora_generate", "content": {"task_ids": ["task-1", "task-2"]}}
        ]
        return response, tool_payloads

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(nodes, "agent_session", fake_agent_session)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_turn)
    monkeypatch.setattr(nodes, "extract_content", lambda _resp: "producer output")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")

    result = await nodes.production_node(state)
    assert result["status"] == RunStatus.AWAITING_VIDEO_GENERATION.value
    assert result["pending_task_ids"] == ["task-1", "task-2"]
    run_repo.update_async.assert_awaited()
    run_repo.add_artifact_async.assert_awaited()


@pytest.mark.asyncio
async def test_editing_node_real_mode_remotion_fake(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "video_clips": ["https://example.com/1.mp4"],
    }

    run = FakeRun(run_id, artifacts={"ideas": "creative", "overlays": []})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.get_by_run_async = AsyncMock(
        return_value=[
            FakeArtifact(
                artifact_type=ArtifactType.VIDEO_CLIP.value,
                uri="https://example.com/1.mp4",
                artifact_metadata={"video_index": 0, "object_name": "obj"},
            )
        ]
    )
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager, contextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    @contextmanager
    def fake_agent_session(_client, _agent, _name):
        yield "session"

    async def fake_run_sync(func, *args, **kwargs):
        return func(*args, **kwargs)

    def fake_turn(*_args, **_kwargs):
        response = Mock()
        tool_payloads = [
            {"tool_name": "remotion_render", "content": {"data": {"job_id": "job-123"}}}
        ]
        return response, tool_payloads

    class FakeSpecs:
        compilation_length = 8

    class FakeProject:
        specs = FakeSpecs()

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(nodes, "agent_session", fake_agent_session)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_turn)
    monkeypatch.setattr(nodes, "extract_content", lambda _resp: "editor output")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes, "effective_remotion_provider", lambda _s: "fake")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "sorted_video_clip_artifacts", lambda artifacts: artifacts)
    monkeypatch.setattr(
        "myloware.storage.object_store.resolve_s3_uri_async",
        AsyncMock(side_effect=lambda url: url),
    )
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _p: FakeProject())
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_editor_prompt",
        lambda **_kwargs: "editor prompt",
    )

    result = await nodes.editing_node(state)
    assert result["status"] == RunStatus.AWAITING_PUBLISH_APPROVAL.value
    assert result["final_video_url"].startswith("https://fake.remotion.com/")
    run_repo.update_async.assert_awaited()


@pytest.mark.asyncio
async def test_publishing_node_real_mode_immediate_url(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://example.com/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "zodiac"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager, contextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    @contextmanager
    def fake_agent_session(_client, _agent, _name):
        yield "session"

    async def fake_run_sync(func, *args, **kwargs):
        return func(*args, **kwargs)

    def fake_turn(*_args, **_kwargs):
        response = Mock()
        tool_payloads = [
            {
                "tool_name": "upload_post",
                "content": {
                    "data": {"published_url": "https://tiktok.com/@x/1", "platform": "tiktok"}
                },
            }
        ]
        return response, tool_payloads

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(nodes, "agent_session", fake_agent_session)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_turn)
    monkeypatch.setattr(nodes, "extract_content", lambda _resp: "publisher output")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt",
        lambda **_kwargs: "publisher prompt",
    )

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.COMPLETED.value
    assert result["publish_complete"] is True


@pytest.mark.asyncio
async def test_publishing_node_real_mode_status_poll(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "publish_approved": True,
        "final_video_url": "https://example.com/final.mp4",
    }

    run = FakeRun(run_id, artifacts={"ideas_structured": {"topic": "zodiac"}})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager, contextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    @contextmanager
    def fake_agent_session(_client, _agent, _name):
        yield "session"

    async def fake_run_sync(func, *args, **kwargs):
        return func(*args, **kwargs)

    def fake_turn(*_args, **_kwargs):
        response = Mock()
        tool_payloads = [
            {
                "tool_name": "upload_post",
                "content": {"data": {"status_url": "https://status.test/1", "request_id": "req-1"}},
            }
        ]
        return response, tool_payloads

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(nodes, "agent_session", fake_agent_session)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_turn)
    monkeypatch.setattr(nodes, "extract_content", lambda _resp: "publisher output")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_publisher_prompt",
        lambda **_kwargs: "publisher prompt",
    )
    monkeypatch.setattr(
        nodes,
        "_poll_upload_post_status",
        AsyncMock(return_value=(["https://tiktok.com/@x/2"], None, {"status": "completed"})),
    )

    result = await nodes.publishing_node(state)
    assert result["status"] == RunStatus.COMPLETED.value
    assert result["published_urls"] == ["https://tiktok.com/@x/2"]


def test_run_guard_calls_shield(monkeypatch):
    from types import SimpleNamespace

    called = {"n": 0}

    class FakeSafety:
        def run_shield(self, content):  # type: ignore[no-untyped-def]
            called["n"] += 1

    client = SimpleNamespace(safety=FakeSafety())
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")

    nodes._run_guard(client, "hi")
    assert called["n"] == 1


def test_run_guard_skips_in_fake_mode(monkeypatch):
    client = SimpleNamespace(safety=Mock())
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", True)
    nodes._run_guard(client, "hi")
    client.safety.run_shield.assert_not_called()


def test_extract_upload_post_urls_nested_payload():
    payload = {
        "results": [
            {"response": {"url": "https://example.com/a"}},
            {"url": "https://example.com/b"},
        ],
        "data": {"url": "https://example.com/a"},
    }
    assert nodes._extract_upload_post_urls(payload) == [
        "https://example.com/a",
        "https://example.com/b",
    ]


def test_extract_upload_post_status_normalizes():
    assert nodes._extract_upload_post_status({"status": " Completed "}) == "completed"
    assert nodes._extract_upload_post_status({"status": 123}) is None


@pytest.mark.asyncio
async def test_get_repositories_async_closes_session(monkeypatch):
    class FakeSession:
        def __init__(self):
            self.closed = False

        async def close(self):  # type: ignore[no-untyped-def]
            self.closed = True

    session = FakeSession()

    monkeypatch.setattr(nodes, "get_async_session_factory", lambda: (lambda: session))
    monkeypatch.setattr(nodes, "RunRepository", lambda _s: "run-repo")
    monkeypatch.setattr(nodes, "ArtifactRepository", lambda _s: "artifact-repo")

    async with nodes._get_repositories_async("run") as (run_repo, artifact_repo, sess):
        assert run_repo == "run-repo"
        assert artifact_repo == "artifact-repo"
        assert sess is session

    assert session.closed is True


@pytest.mark.asyncio
async def test_ideation_node_output_safety_failure(monkeypatch):
    run_id = uuid4()
    state = {"run_id": str(run_id), "project": "aismr", "brief": "b", "vector_db_id": "kb"}

    run = FakeRun(run_id, artifacts={})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.add_artifact_async = AsyncMock()
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(), []

    async def fake_run_sync(fn, *a, **k):  # type: ignore[no-untyped-def]
        return fn(*a, **k)

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "ideas")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes,
        "check_agent_output",
        AsyncMock(return_value=SimpleNamespace(safe=False, reason="bad")),
    )

    result = await nodes.ideation_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "Safety check failed" in result["error"]


@pytest.mark.asyncio
async def test_ideation_node_overlay_extractor_failure_and_status_update_error(monkeypatch):
    run_id = uuid4()
    state = {"run_id": str(run_id), "project": "aismr", "brief": "b", "vector_db_id": "kb"}

    run = FakeRun(run_id, artifacts={})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.add_artifact_async = AsyncMock()
    run_repo.update_async = AsyncMock(side_effect=RuntimeError("update failed"))

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(), []

    async def fake_run_sync(fn, *a, **k):  # type: ignore[no-untyped-def]
        return fn(*a, **k)

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "ideas")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "parse_structured_ideation", lambda _t: {"topic": "t"})
    monkeypatch.setattr(
        "myloware.config.projects.load_project",
        lambda _p: SimpleNamespace(overlay_extractor="boom"),
    )

    def explode(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("extractor failed")

    monkeypatch.setattr("myloware.workflows.extractors.get_extractor", lambda _n: explode)
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())

    result = await nodes.ideation_node(state)
    assert result["status"] == RunStatus.AWAITING_IDEATION_APPROVAL.value
    assert result["overlays"] is None


@pytest.mark.asyncio
async def test_production_node_parses_tool_response_json_string(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "ideas_approved": True,
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()
    run_repo.add_artifact_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [
        {
            "tool_name": "sora_generate",
            "content": '{"data": {"task_ids": ["task-123"]}}',
        }
    ]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(), tool_payloads

    async def fake_run_sync(fn, *a, **k):  # type: ignore[no-untyped-def]
        return fn(*a, **k)

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "producer output")
    monkeypatch.setattr(nodes, "_strip_noise_for_safety", lambda _t: "producer output")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)

    result = await nodes.production_node(state)
    assert result["status"] == RunStatus.AWAITING_VIDEO_GENERATION.value
    assert result["pending_task_ids"] == ["task-123"]


@pytest.mark.asyncio
async def test_production_node_falls_back_to_manifest_task_ids(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "ideas_approved": True,
    }

    run = FakeRun(run_id, artifacts={"ideas": "idea"})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()
    run_repo.add_artifact_async = AsyncMock()

    manifest = FakeArtifact(
        ArtifactType.CLIP_MANIFEST.value,
        content='{"task-a": {"video_index": 0}}',
        artifact_metadata={"type": "task_metadata_mapping"},
    )
    artifact_repo = Mock()
    artifact_repo.create_async = AsyncMock()
    artifact_repo.get_by_run_async = AsyncMock(return_value=[manifest])

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class _SessionCtx:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return "sess"

        def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    tool_payloads = [{"tool_name": "other", "content": "noop"}]

    def fake_collect(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(), tool_payloads

    async def fake_run_sync(fn, *a, **k):  # type: ignore[no-untyped-def]
        return fn(*a, **k)

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(nodes, "agent_session", lambda *_a, **_k: _SessionCtx())
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_collect)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "extract_content", lambda _r: "producer output")
    monkeypatch.setattr(nodes, "_strip_noise_for_safety", lambda _t: "producer output")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)

    result = await nodes.production_node(state)
    assert result["status"] == RunStatus.AWAITING_VIDEO_GENERATION.value
    assert result["pending_task_ids"] == ["task-a"]


@pytest.mark.asyncio
async def test_editing_node_no_video_clips_in_artifacts(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "video_clips": ["https://example.com/clip.mp4"],
    }

    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=FakeRun(run_id))

    artifact_repo = Mock()
    artifact_repo.get_by_run_async = AsyncMock(return_value=[])

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())

    result = await nodes.editing_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "No video clips found" in result["error"]


@pytest.mark.asyncio
async def test_editing_node_input_safety_failure(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "video_clips": ["https://example.com/1.mp4"],
    }

    run = FakeRun(run_id, artifacts={"ideas": "creative", "overlays": [{"text": "t"}]})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)

    artifact_repo = Mock()
    artifact_repo.get_by_run_async = AsyncMock(
        return_value=[
            FakeArtifact(
                artifact_type=ArtifactType.VIDEO_CLIP.value,
                uri="https://example.com/1.mp4",
                artifact_metadata={"video_index": 0},
            )
        ]
    )

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    class FakeSpecs:
        compilation_length = 8

    class FakeProject:
        specs = FakeSpecs()

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *a, **k: Mock())
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=False, reason="no"))
    )
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes, "sorted_video_clip_artifacts", lambda artifacts: artifacts)
    monkeypatch.setattr(
        "myloware.storage.object_store.resolve_s3_uri_async",
        AsyncMock(side_effect=lambda url: url),
    )
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _p: FakeProject())
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_editor_prompt",
        lambda **_kwargs: "editor prompt",
    )

    result = await nodes.editing_node(state)
    assert result["status"] == RunStatus.FAILED.value
    assert "Input safety check failed" in result["error"]


@pytest.mark.asyncio
async def test_editing_node_parses_render_job_id_from_json_string(monkeypatch):
    run_id = uuid4()
    state = {
        "run_id": str(run_id),
        "project": "aismr",
        "vector_db_id": "kb",
        "video_clips": ["https://example.com/1.mp4"],
    }

    run = FakeRun(run_id, artifacts={"ideas": "creative", "overlays": []})
    run_repo = Mock()
    run_repo.get_async = AsyncMock(return_value=run)
    run_repo.update_async = AsyncMock()

    artifact_repo = Mock()
    artifact_repo.get_by_run_async = AsyncMock(
        return_value=[
            FakeArtifact(
                artifact_type=ArtifactType.VIDEO_CLIP.value,
                uri="https://example.com/1.mp4",
                artifact_metadata={"video_index": 0, "object_name": "obj"},
            )
        ]
    )
    artifact_repo.create_async = AsyncMock()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    from contextlib import asynccontextmanager, contextmanager

    @asynccontextmanager
    async def fake_repos(_run_id: str):
        yield run_repo, artifact_repo, session

    @contextmanager
    def fake_agent_session(_client, _agent, _name):
        yield "session"

    async def fake_run_sync(func, *args, **kwargs):
        return func(*args, **kwargs)

    def fake_turn(*_args, **_kwargs):
        response = Mock()
        tool_payloads = [
            {"tool_name": "remotion_render", "content": '{"data": {"job_id": "job-999"}}'}
        ]
        return response, tool_payloads

    class FakeSpecs:
        compilation_length = 8

    class FakeProject:
        specs = FakeSpecs()

    monkeypatch.setattr(nodes, "_get_repositories_async", fake_repos)
    monkeypatch.setattr(nodes, "get_sync_client", lambda: Mock())
    monkeypatch.setattr(nodes, "get_async_client", lambda: Mock())
    monkeypatch.setattr(nodes, "create_agent", lambda *args, **kwargs: Mock())
    monkeypatch.setattr(nodes, "agent_session", fake_agent_session)
    monkeypatch.setattr(nodes.anyio.to_thread, "run_sync", fake_run_sync)
    monkeypatch.setattr(nodes, "create_turn_collecting_tool_responses", fake_turn)
    monkeypatch.setattr(nodes, "extract_content", lambda _resp: "editor output")
    monkeypatch.setattr(
        nodes, "check_agent_input", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(
        nodes, "check_agent_output", AsyncMock(return_value=SimpleNamespace(safe=True))
    )
    monkeypatch.setattr(nodes, "_maybe_store_safety_cache", AsyncMock())
    monkeypatch.setattr(nodes, "effective_llama_stack_provider", lambda _s: "real")
    monkeypatch.setattr(nodes, "effective_remotion_provider", lambda _s: "real")
    monkeypatch.setattr(nodes.settings, "disable_background_workflows", False)
    monkeypatch.setattr(nodes, "sorted_video_clip_artifacts", lambda artifacts: artifacts)
    monkeypatch.setattr(
        "myloware.storage.object_store.resolve_s3_uri_async",
        AsyncMock(side_effect=lambda url: url),
    )
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _p: FakeProject())
    monkeypatch.setattr(
        "myloware.workflows.langgraph.prompts.build_editor_prompt",
        lambda **_kwargs: "editor prompt",
    )

    result = await nodes.editing_node(state)
    assert result["status"] == RunStatus.AWAITING_RENDER.value
    assert result["render_job_id"] == "job-999"
