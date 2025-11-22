"""Brendan's conversation graph with persistent multi-turn loops."""
from __future__ import annotations

# mypy: ignore-errors

from langgraph.graph import END, START, StateGraph

from .brendan_agent import run_brendan_agent
from .brendan_state import ConversationState
from .checkpointer import PostgresCheckpointer
from .config import settings


def build_brendan_graph(checkpointer: PostgresCheckpointer | None = None) -> StateGraph:
    """Build Brendan's conversation graph.
    
    Uses user_id as thread_id for persistent conversations across multiple turns.
    """
    from langgraph.graph import END
    
    graph = StateGraph(ConversationState)
    
    # Single node: Brendan agent
    graph.add_node("brendan", run_brendan_agent)
    
    # Start → Brendan
    graph.add_edge(START, "brendan")
    
    # Brendan → END (single turn for now; multi-turn handled by external loop)
    # TODO: Add conditional edge for multi-turn if needed
    graph.add_edge("brendan", END)
    
    return graph


def compile_brendan_graph(checkpointer: PostgresCheckpointer | None = None):
    """Compile Brendan's graph with checkpointing."""
    graph = build_brendan_graph(checkpointer)
    # For now, compile without LangGraph's built-in checkpointer
    # We'll handle persistence manually via PostgresCheckpointer
    return graph.compile()
