from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pytest

from apps.orchestrator import brendan_agent
from apps.orchestrator.brendan_state import ConversationState


@dataclass
class FakeMessage:
    content: str


def fake_tool(name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:  # type: ignore[type-arg]
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        setattr(func, "name", name)
        return func

    return decorator


class FakeAgentGraph:
    def __init__(self, tools: list[Callable[..., Any]]) -> None:
        self.tools = {getattr(tool, "name", f"tool_{idx}"): tool for idx, tool in enumerate(tools)}

    def invoke(self, payload: dict[str, Any]) -> dict[str, list[FakeMessage]]:
        messages = payload.get("messages", [])
        last = messages[-1]
        text = getattr(last, "content", "")
        if not text and isinstance(last, dict):  # pragma: no cover - defensive
            text = str(last.get("content", ""))
        lower = text.lower()
        if "aismr" in lower or "kb" in lower:
            summary = self.tools["memory_search"]("aismr", 3)
            return {"messages": [FakeMessage(summary)]}
        if "approval" in lower:
            link = self.tools["request_hitl_link"]()
            return {"messages": [FakeMessage(link)]}
        return {"messages": [FakeMessage("ok")]}  # pragma: no cover - default branch


@pytest.fixture()
def langchain_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(brendan_agent, "LANGCHAIN_AVAILABLE", True)
    monkeypatch.setattr(brendan_agent, "tool", fake_tool)
    monkeypatch.setattr(brendan_agent, "ChatOpenAI", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        brendan_agent,
        "create_agent",
        lambda model, tools, system_prompt: FakeAgentGraph(tools),
        raising=False,
    )

    def _fake_search_kb(dsn: str, query: str, k: int = 5, project: str | None = None, persona: str | None = None):
        docs = [(f"doc-{i}", f"path-{i}", 0.9 - i * 0.1, f"snippet {i}") for i in range(k)]
        return docs, 4

    monkeypatch.setattr(brendan_agent, "search_kb", _fake_search_kb, raising=False)


def test_run_brendan_agent_traces_memory_search(langchain_stub: None) -> None:
    state: ConversationState = {
        "user_id": "demo",
        "current_message": "Tell me about AISMR",
        "messages": [],
    }

    result = brendan_agent.run_brendan_agent(state)

    assert "path-0" in result["response"]
    traces = result.get("retrieval_traces") or []
    assert traces and traces[-1]["query"] == "aismr"


def test_run_brendan_agent_returns_fallback_when_langchain_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(brendan_agent, "LANGCHAIN_AVAILABLE", False)
    state: ConversationState = {"user_id": "demo", "current_message": "hello", "messages": []}

    result = brendan_agent.run_brendan_agent(state)

    assert "Brendan is processing" in result["response"]
    assert len(result["messages"]) == 2
