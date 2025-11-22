from __future__ import annotations

from langgraph.graph import StateGraph

from apps.orchestrator import brendan_graph
from apps.orchestrator import brendan_agent


def test_build_brendan_graph_contains_single_brendan_node() -> None:
    graph = brendan_graph.build_brendan_graph()
    assert isinstance(graph, StateGraph)
    # StateGraph stores nodes in a dict-like structure on the internal graph object.
    assert "brendan" in graph.nodes


def test_compile_brendan_graph_produces_callable(monkeypatch) -> None:
    # Avoid calling real LangChain/OpenAI during unit tests.
    monkeypatch.setattr(brendan_agent, "LANGCHAIN_AVAILABLE", False)
    compiled = brendan_graph.compile_brendan_graph()
    # Compiled graph should be invocable with a minimal conversation state.
    result = compiled.invoke({"messages": [], "user_id": "test-user"})
    # Brendan agent may produce any response; we just assert it returns a mapping.
    assert isinstance(result, dict)
