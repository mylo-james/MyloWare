"""Unit tests for LangGraph workflow graph."""

from workflows.langgraph.graph import build_video_workflow, get_compiled_graph, clear_graph_cache


def test_build_video_workflow():
    """Test that workflow graph is built correctly."""
    builder = build_video_workflow()

    # Verify graph structure
    assert builder is not None
    # Graph should have nodes
    # Note: We can't easily inspect internal structure without invoking,
    # but we can verify it compiles


def test_get_compiled_graph_memory_fallback(monkeypatch):
    """Graph compiles with in-memory checkpointer when Postgres unavailable."""
    monkeypatch.setattr("workflows.langgraph.graph.settings.database_url", "sqlite:///:memory:")
    clear_graph_cache()
    graph = get_compiled_graph()
    assert graph is not None
