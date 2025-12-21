from __future__ import annotations

import json
from types import SimpleNamespace

from llama_stack_client.types import CompletionMessage

from myloware.agents.tool_parser import LlamaToolParser


def test_get_tool_calls_returns_empty_when_content_empty() -> None:
    parser = LlamaToolParser()
    msg = CompletionMessage(content="", role="assistant", stop_reason="end_of_turn")
    assert parser.get_tool_calls(msg) == []


def test_get_tool_calls_converts_non_string_content() -> None:
    parser = LlamaToolParser()
    msg = SimpleNamespace(content=123)
    assert parser.get_tool_calls(msg) == []


def test_get_tool_calls_parses_python_tag_calls_and_increments_ids() -> None:
    parser = LlamaToolParser()
    content = (
        '<|python_tag|>{"type":"function","name":"alpha","parameters":"hi"}\n'
        '<|python_tag|>{"type":"function","name":"beta","parameters":"bye"}\n'
    )
    msg = CompletionMessage(content=content, role="assistant", stop_reason="end_of_turn")
    calls = parser.get_tool_calls(msg)

    assert [c.call_id for c in calls] == ["call_0", "call_1"]
    assert [c.tool_name for c in calls] == ["alpha", "beta"]
    assert calls[0].arguments == json.dumps({"value": "hi"})


def test_get_tool_calls_skips_invalid_python_tag_json_but_still_parses_plain_json() -> None:
    parser = LlamaToolParser()
    content = (
        '<|python_tag|>{"type":"function","name":"bad",}\n'
        '{"type":"function","name":"good","parameters":{"a":1}}\n'
    )
    msg = CompletionMessage(content=content, role="assistant", stop_reason="end_of_turn")
    calls = parser.get_tool_calls(msg)

    assert len(calls) == 1
    assert calls[0].tool_name == "good"
    assert json.loads(calls[0].arguments) == {"a": 1}


def test_get_tool_calls_parses_plain_json_with_dict_list_and_string_params() -> None:
    parser = LlamaToolParser()
    content = "\n".join(
        [
            '{"type":"function","name":"dict_params","parameters":{"a":1}}',
            '{"type":"function","name":"list_params","parameters":[1,2,3]}',
            '{"type":"function","name":"string_params","parameters":"hello"}',
        ]
    )
    msg = CompletionMessage(content=content, role="assistant", stop_reason="end_of_turn")
    calls = parser.get_tool_calls(msg)

    assert [c.tool_name for c in calls] == ["dict_params", "list_params", "string_params"]
    assert json.loads(calls[0].arguments) == {"a": 1}
    assert json.loads(calls[1].arguments) == [1, 2, 3]
    assert calls[2].arguments == "hello"


def test_get_tool_calls_skips_invalid_plain_json_parameters() -> None:
    parser = LlamaToolParser()
    msg = CompletionMessage(
        content='{"type":"function","name":"bad","parameters":{oops}}',
        role="assistant",
        stop_reason="end_of_turn",
    )
    assert parser.get_tool_calls(msg) == []


def test_parse_tool_dict_handles_alt_keys_and_arguments_sources() -> None:
    parser = LlamaToolParser()

    assert parser._parse_tool_dict({}, "call_x") is None

    call = parser._parse_tool_dict(
        {"tool_name": "alpha", "arguments": {"x": 1}},
        "call_a",
    )
    assert call and call.tool_name == "alpha"
    assert json.loads(call.arguments) == {"x": 1}

    call = parser._parse_tool_dict(
        {"function": "beta", "args": '{"y":2}'},
        "call_b",
    )
    assert call and call.tool_name == "beta"
    assert json.loads(call.arguments) == {"y": 2}

    call = parser._parse_tool_dict(
        {"name": "gamma", "parameters": "not-json"},
        "call_c",
    )
    assert call and call.tool_name == "gamma"
    assert json.loads(call.arguments) == {"value": "not-json"}
