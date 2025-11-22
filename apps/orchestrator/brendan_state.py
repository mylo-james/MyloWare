"""Brendan conversation state definition."""
from __future__ import annotations

from typing import Any, TypedDict


class ConversationState(TypedDict, total=False):
    """State for Brendan's conversation graph.
    
    Uses user_id as thread_id for persistent conversations.
    """
    user_id: str
    messages: list[dict[str, Any]]  # Conversation history
    current_message: str  # Latest user message
    response: str  # Brendan's response
    run_ids: list[str]  # Runs started by this user
    retrieval_traces: list[dict[str, Any]]  # RAG audit trail
    citations: list[dict[str, Any]]  # Citations from RAG queries
    pending_gate: dict[str, Any]
