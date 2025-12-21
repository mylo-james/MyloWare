from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from myloware.storage.models import ArtifactType
from myloware.workflows.langgraph.agent_io import (
    SimpleMessage,
    _maybe_store_safety_cache,
    _strip_noise_for_safety,
    _tool_response_contents,
    _tool_response_contents_from_payloads,
    agent_session,
    create_turn_collecting_tool_responses,
    extract_content,
)


def test_agent_session_deletes_conversation() -> None:
    deleted: list[str] = []

    class FakeConversations:
        def delete(self, *, conversation_id: str) -> None:
            deleted.append(conversation_id)

    class FakeClient:
        conversations = FakeConversations()

    class FakeAgent:
        def create_session(self, _name: str) -> str:
            return "sess-123"

    with agent_session(FakeClient(), FakeAgent(), "name") as session_id:
        assert session_id == "sess-123"

    assert deleted == ["sess-123"]


def test_agent_session_swallows_cleanup_errors() -> None:
    class FakeConversations:
        def delete(self, *, conversation_id: str) -> None:
            raise RuntimeError(f"boom {conversation_id}")

    class FakeClient:
        conversations = FakeConversations()

    class FakeAgent:
        def create_session(self, _name: str) -> str:
            return "sess-err"

    with agent_session(FakeClient(), FakeAgent(), "name") as session_id:
        assert session_id == "sess-err"


def test_extract_content_prefers_output_text() -> None:
    resp = SimpleNamespace(output_text="hello")
    assert extract_content(resp) == "hello"


def test_extract_content_returns_empty_on_none() -> None:
    assert extract_content(None) == ""


def test_extract_content_falls_back_to_choices_message_content() -> None:
    resp = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="hi"))])
    assert extract_content(resp) == "hi"


def test_extract_content_falls_back_to_content_attr() -> None:
    resp = SimpleNamespace(content="content")
    assert extract_content(resp) == "content"


def test_strip_noise_for_safety_redacts_common_ids() -> None:
    raw = (
        "job_abcdef12 uuid=00000000-0000-0000-0000-000000000123 "
        "video_12345678 https://example.com/x"
    )
    cleaned = _strip_noise_for_safety(raw)
    assert "<render_job_id>" in cleaned
    assert "<uuid>" in cleaned
    assert "<video_task_id>" in cleaned
    assert "<url>" in cleaned


def test_strip_noise_for_safety_empty_returns_empty() -> None:
    assert _strip_noise_for_safety("") == ""


def test_tool_response_contents_collects_across_shapes() -> None:
    @dataclass
    class ToolResp:
        tool_name: str
        content: object

    response = SimpleNamespace(
        steps=[
            SimpleNamespace(
                step_type="tool_execution",
                result=SimpleNamespace(
                    tool_responses=[
                        {"tool_name": "alpha", "content": {"ok": True}},
                        ToolResp(tool_name="alpha", content="x"),
                        ToolResp(tool_name="beta", content="y"),
                    ]
                ),
            )
        ],
        result=SimpleNamespace(
            tool_responses=[
                {"tool_name": "alpha", "content": "from-result"},
            ]
        ),
        tool_responses=[{"tool_name": "alpha", "content": "from-top"}],
    )

    contents = _tool_response_contents(response, "alpha")
    assert contents == [{"ok": True}, "x", "from-result", "from-top"]


def test_tool_response_contents_skips_non_tool_steps_and_none_payloads() -> None:
    response = SimpleNamespace(
        steps=[
            SimpleNamespace(step_type="not_tool_execution", result=None),
            SimpleNamespace(
                step_type="tool_execution",
                tool_responses=[None, {"tool_name": "alpha", "content": "x"}],
            ),
        ],
        result=None,
        tool_responses=None,
    )

    assert _tool_response_contents(response, "alpha") == ["x"]


def test_tool_response_contents_from_payloads_filters() -> None:
    payloads = [
        {"tool_name": "a", "content": 1},
        {"tool_name": "b", "content": 2},
        {"tool_name": "a", "content": 3},
    ]
    assert _tool_response_contents_from_payloads(payloads, "a") == [1, 3]


def test_create_turn_collecting_tool_responses_collects_dict_and_object() -> None:
    @dataclass
    class ToolRespObj:
        call_id: str
        tool_name: str
        content: object
        metadata: dict[str, object] | None = None

    class FakeAgent:
        def create_turn(self, _messages, _session_id, *, stream: bool):  # type: ignore[no-untyped-def]
            assert stream is True
            yield SimpleNamespace(
                event=SimpleNamespace(
                    step_type="tool_execution",
                    result=SimpleNamespace(
                        tool_responses=[
                            {"tool_name": "alpha", "content": {"ok": True}},
                            ToolRespObj(call_id="c1", tool_name="beta", content="x"),
                        ]
                    ),
                ),
                response=None,
            )
            yield SimpleNamespace(event=None, response="final")

    final, tool_responses = create_turn_collecting_tool_responses(
        FakeAgent(), [{"role": "user", "content": "hi"}], "sess"
    )

    assert final == "final"
    assert tool_responses == [
        {"tool_name": "alpha", "content": {"ok": True}},
        {"call_id": "c1", "tool_name": "beta", "content": "x", "metadata": None},
    ]


def test_create_turn_collecting_tool_responses_raises_without_final_response() -> None:
    class FakeAgent:
        def create_turn(self, _messages, _session_id, *, stream: bool):  # type: ignore[no-untyped-def]
            assert stream is True
            yield SimpleNamespace(event=None, response=None)

    with pytest.raises(RuntimeError, match="did not complete"):
        create_turn_collecting_tool_responses(FakeAgent(), [], "sess")


@pytest.mark.asyncio
async def test_maybe_store_safety_cache_creates_artifact() -> None:
    calls: list[dict[str, object]] = []
    run_id = uuid4()

    class FakeArtifactRepo:
        async def create_async(self, **kwargs):  # type: ignore[no-untyped-def]
            calls.append(kwargs)
            return None

    state = {"safety_cache": {"a": {"safe": True}}}
    await _maybe_store_safety_cache(state, FakeArtifactRepo(), UUID(str(run_id)))

    assert calls
    assert calls[0]["artifact_type"] == ArtifactType.SAFETY_VERDICT


@pytest.mark.asyncio
async def test_maybe_store_safety_cache_noops_when_empty() -> None:
    calls: list[dict[str, object]] = []

    class FakeArtifactRepo:
        async def create_async(self, **kwargs):  # type: ignore[no-untyped-def]
            calls.append(kwargs)
            return None

    await _maybe_store_safety_cache({"safety_cache": {}}, FakeArtifactRepo(), uuid4())
    assert calls == []


@pytest.mark.asyncio
async def test_maybe_store_safety_cache_swallows_write_errors() -> None:
    class FakeArtifactRepo:
        async def create_async(self, **_kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError("boom")

    await _maybe_store_safety_cache({"safety_cache": {"x": 1}}, FakeArtifactRepo(), uuid4())


def test_simple_message_exposes_content() -> None:
    msg = SimpleMessage("x")
    assert msg.content == "x"
