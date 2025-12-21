from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from myloware.workflows.langgraph import agent_io


def test_agent_session_cleans_up() -> None:
    agent = Mock()
    agent.create_session.return_value = "session-1"
    client = Mock()
    client.conversations.delete = Mock()

    with agent_io.agent_session(client, agent, "demo") as session_id:
        assert session_id == "session-1"

    client.conversations.delete.assert_called_once_with(conversation_id="session-1")


def test_agent_session_cleanup_failure_does_not_raise() -> None:
    agent = Mock()
    agent.create_session.return_value = "session-2"
    client = Mock()
    client.conversations.delete.side_effect = RuntimeError("boom")

    with agent_io.agent_session(client, agent, "demo"):
        pass


def test_extract_content_prefers_output_text() -> None:
    resp = SimpleNamespace(
        output_text="hello", choices=[SimpleNamespace(message=None)], content="x"
    )
    assert agent_io.extract_content(resp) == "hello"


def test_extract_content_falls_back_to_choices_then_content() -> None:
    resp = SimpleNamespace(
        output_text=None,
        choices=[SimpleNamespace(message=SimpleNamespace(content="from choices"))],
        content="from content",
    )
    assert agent_io.extract_content(resp) == "from choices"

    resp2 = SimpleNamespace(output_text=None, choices=[], content="from content")
    assert agent_io.extract_content(resp2) == "from content"


def test_strip_noise_for_safety_removes_or_masks_tokens() -> None:
    text = (
        "CRITICAL: DO NOT just output code\n"
        "video_abcd1234 job_abcdef123456 fake-render-xyz\n"
        'https://example.com/path and "https://example.com/quoted"\n'
        "uuid 123e4567-e89b-12d3-a456-426614174000"
    )
    cleaned = agent_io._strip_noise_for_safety(text)
    assert "CRITICAL" not in cleaned
    assert "video_abcd" not in cleaned
    assert "job_" not in cleaned
    assert "fake-render" not in cleaned
    assert "https://example.com" not in cleaned
    assert "<uuid>" in cleaned or cleaned == ""


@pytest.mark.asyncio
async def test_maybe_store_safety_cache_persists_artifact() -> None:
    repo = Mock()
    repo.create_async = AsyncMock()
    state = {"safety_cache": {"a": {"safe": True}}}

    await agent_io._maybe_store_safety_cache(state, repo, uuid4())

    repo.create_async.assert_awaited_once()


@pytest.mark.asyncio
async def test_maybe_store_safety_cache_noop_on_empty_cache() -> None:
    repo = Mock()
    repo.create_async = AsyncMock()
    state = {"safety_cache": {}}

    await agent_io._maybe_store_safety_cache(state, repo, uuid4())

    repo.create_async.assert_not_awaited()


@pytest.mark.asyncio
async def test_maybe_store_safety_cache_handles_errors() -> None:
    repo = Mock()
    repo.create_async = AsyncMock(side_effect=RuntimeError("fail"))
    state = {"safety_cache": {"a": {"safe": False}}}

    await agent_io._maybe_store_safety_cache(state, repo, uuid4())


def test_tool_response_contents_collects_across_shapes() -> None:
    class Step:
        step_type = "tool_execution"

        def __init__(self, responses):
            self.result = SimpleNamespace(tool_responses=responses)

    response = SimpleNamespace(
        steps=[
            Step(
                [
                    {"tool_name": "alpha", "content": "one"},
                    SimpleNamespace(tool_name="alpha", content="two"),
                    {"tool_name": "beta", "content": "skip"},
                ]
            )
        ],
        result=SimpleNamespace(tool_responses=[{"tool_name": "alpha", "content": "three"}]),
        tool_responses=[{"tool_name": "alpha", "content": "four"}],
    )

    contents = agent_io._tool_response_contents(response, "alpha")
    assert contents == ["one", "two", "three", "four"]


def test_create_turn_collecting_tool_responses_non_iterable() -> None:
    class Step:
        step_type = "tool_execution"

        def __init__(self, responses):
            self.tool_responses = responses

    response = SimpleNamespace(
        steps=[Step([{"tool_name": "alpha", "content": "x"}])],
        result=None,
        tool_responses=[{"tool_name": "alpha", "content": "y"}],
    )
    agent = Mock()
    agent.create_turn.return_value = response

    final, payloads = agent_io.create_turn_collecting_tool_responses(
        agent, [{"role": "user", "content": "hi"}], "session-1"
    )

    assert final is response
    assert any(p["content"] == "x" for p in payloads)
    assert any(p["content"] == "y" for p in payloads)


def test_create_turn_collecting_tool_responses_streaming_merges_payloads() -> None:
    class Event:
        step_type = "tool_execution"

        def __init__(self):
            self.result = SimpleNamespace(
                tool_responses=[{"call_id": "c1", "tool_name": "alpha", "content": "stream"}]
            )

    class Chunk:
        def __init__(self, event=None, response=None):
            self.event = event
            self.response = response

    final_response = SimpleNamespace(
        steps=[],
        result=SimpleNamespace(
            tool_responses=[
                {"call_id": "c1", "tool_name": "alpha", "content": "stream"},
                {"call_id": "c2", "tool_name": "alpha", "content": "final"},
            ]
        ),
    )

    def _stream():
        yield Chunk(event=Event())
        yield Chunk(response=final_response)

    agent = Mock()
    agent.create_turn.return_value = _stream()

    final, payloads = agent_io.create_turn_collecting_tool_responses(
        agent, [{"role": "user", "content": "hi"}], "session-2"
    )

    assert final is final_response
    contents = [p.get("content") for p in payloads]
    assert "stream" in contents
    assert "final" in contents


def test_create_turn_collecting_tool_responses_requires_final_response() -> None:
    class Chunk:
        def __init__(self, event=None, response=None):
            self.event = event
            self.response = response

    def _stream():
        yield Chunk(event=SimpleNamespace(step_type="tool_execution", result=SimpleNamespace()))

    agent = Mock()
    agent.create_turn.return_value = _stream()

    with pytest.raises(RuntimeError):
        agent_io.create_turn_collecting_tool_responses(
            agent, [{"role": "user", "content": "hi"}], "session-3"
        )


def test_tool_response_contents_from_payloads_filters() -> None:
    payloads = [
        {"tool_name": "alpha", "content": "one"},
        {"tool_name": "beta", "content": "skip"},
        {"name": "alpha", "content": "two"},
    ]
    assert agent_io._tool_response_contents_from_payloads(payloads, "alpha") == ["one", "two"]
