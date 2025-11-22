from __future__ import annotations

import copy
from typing import Any

import pytest

from apps.orchestrator import persona_nodes
from apps.orchestrator.run_state import RunState


class FakeAgent:
    invocations = 0
    last_tools: list[str] = []
    invoke_memory = True

    def __init__(self, *_, tools=None, **__):  # noqa: ANN401
        FakeAgent.invocations = 0
        FakeAgent.last_tools = [getattr(t, "name", "") for t in (tools or [])]
        self._tools = tools or []

    def invoke(self, payload):  # type: ignore[no-untyped-def]
        FakeAgent.invocations += 1
        if FakeAgent.invoke_memory:
            for tool in self._tools:
                if getattr(tool, "name", "") == "memory_search":
                    try:
                        tool.invoke({"query": "test query", "k": 5})
                    except Exception:
                        pass
                    break
        return {"messages": [{"content": "LLM output"}]}


@pytest.fixture(autouse=True)
def patch_langchain(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeAgent.invocations = 0
    FakeAgent.invoke_memory = True
    monkeypatch.setattr(persona_nodes, "LANGCHAIN_AVAILABLE", True, raising=False)
    monkeypatch.setattr(persona_nodes, "RETRIEVAL_AVAILABLE", True, raising=False)
    monkeypatch.setattr(persona_nodes.settings, "enable_langchain_personas", True, raising=False)

    class _FakeStructuredTool:
        def __init__(self, func, name: str, schema: type[Any] | None = None) -> None:  # noqa: ANN001
            self._func = func
            self.name = name
            self._schema = schema
            self._invoke_payloads: list[Any] = []

        def __call__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return self._func(*args, **kwargs)

        def invoke(self, payload):  # type: ignore[no-untyped-def]
            self._invoke_payloads.append(payload)
            if isinstance(payload, dict):
                if self._schema:
                    model = self._schema(**payload)
                    data = model.model_dump()
                    return self._func(**data)
                return self._func(**payload)
            return self._func(payload)

    def fake_tool(name: str, *_, **tool_kwargs):  # type: ignore[no-untyped-def]
        schema = tool_kwargs.get("args_schema")

        def decorator(func):  # type: ignore[no-untyped-def]
            return _FakeStructuredTool(func, name, schema)

        return decorator

    monkeypatch.setattr(persona_nodes, "tool", fake_tool, raising=False)
    monkeypatch.setattr(persona_nodes, "ChatOpenAI", lambda *_, **__: None, raising=False)

    def _create_agent(model, tools, system_prompt):  # noqa: ANN001, ARG001
        return FakeAgent(tools=tools)

    monkeypatch.setattr(persona_nodes, "create_agent", _create_agent, raising=False)

    def fake_search_kb(_dsn, query, k=5, project=None, persona=None):  # noqa: ANN001, ARG001
        return [
            ("doc", f"data/{project}/{persona}.md", 0.91, f"Snippet for {query}"),
        ], 12.3

    monkeypatch.setattr(persona_nodes, "search_kb", fake_search_kb, raising=False)
    sample_snapshot = {
        "runId": "snapshot",
        "result": {
            "videos": [
                {
                    "index": 0,
                    "subject": "candles",
                    "header": "Variant",
                    "status": "pending",
                    "prompt": "Close-up of candles",
                }
            ],
            "publishUrls": [],
        },
        "artifacts": [],
    }

    def fake_snapshot(run_id: str) -> dict[str, Any]:
        snapshot = copy.deepcopy(sample_snapshot)
        snapshot["runId"] = run_id
        return snapshot

    monkeypatch.setattr(persona_nodes, "_get_run_snapshot", fake_snapshot, raising=False)

    allowed_tools_map = {
        "iggy": ["memory_search"],
        "riley": ["memory_search", "submit_generation_jobs_tool", "wait_for_generations_tool"],
        "alex": ["memory_search", "render_video_timeline_tool"],
        "quinn": ["memory_search", "publish_to_tiktok_tool"],
    }
    context_calls: list[tuple[RunState, dict[str, Any], str]] = []

    def fake_build_persona_context(state, project_spec, persona):  # noqa: ANN001
        context_calls.append((state, project_spec, persona))
        allowed = allowed_tools_map.get(persona, ["memory_search"])
        kb_override = state.get("_test_kb_queries_override")
        if kb_override is None:
            kb_override = [f"{persona} knowledge query"]
        return {
            "persona": persona,
            "persona_profile": {"name": persona},
            "project_spec": project_spec,
            "allowed_tools": list(allowed),
            "instructions": f"Act as {persona}",
            "materials": dict(state),
            "constraints": {},
            "kb_queries": list(kb_override),
        }

    monkeypatch.setattr(persona_nodes, "build_persona_context", fake_build_persona_context, raising=False)
    persona_nodes._TEST_ALLOWED_TOOLS = allowed_tools_map  # type: ignore[attr-defined]
    persona_nodes._TEST_CONTEXT_CALLS = context_calls  # type: ignore[attr-defined]


def test_aismr_langchain_persona_prefetches_rag(monkeypatch: pytest.MonkeyPatch) -> None:
    state: RunState = {
        "run_id": "aismr-langchain",
        "project": "aismr",
        "input": "candles",
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("iggy", "aismr")
    result = node(state)

    assert result.get("videos"), "Observer should load videos from run snapshot"
    assert result.get("retrieval_traces"), "RAG traces should be recorded"
    assert FakeAgent.invocations == 1



def test_persona_errors_when_langchain_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(persona_nodes, "LANGCHAIN_AVAILABLE", False, raising=False)
    node = persona_nodes.create_persona_node("iggy", "aismr")
    state: RunState = {
        "run_id": "fallback",
        "project": "aismr",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }
    with pytest.raises(RuntimeError, match="LangChain persona execution disabled"):
        node(state)


def test_persona_tools_respect_allowlist_from_persona_config() -> None:
    """LangChain personas must only receive tools in their allowlist."""
    state: RunState = {
        "run_id": "test_video_gen-tools",
        "project": "test_video_gen",
        "input": "AI roommates",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("iggy", "test_video_gen")
    _ = node(state)

    #iggy persona.json does not list transfer_to_quinn,
    # so the tool set should be restricted to those in allowedTools.
    assert FakeAgent.invocations == 1
    assert FakeAgent.last_tools, "Expected LangChain tools to be passed to FakeAgent"
    allowed = set(FakeAgent.last_tools)
    assert "memory_search" in allowed
    # Handoff tools must only appear when explicitly allowed.
    assert "transfer_to_quinn" not in allowed


def test_quinn_state_includes_render_url_from_artifacts(monkeypatch: pytest.MonkeyPatch) -> None:
    """Quinn should see the final render URL even if run_result lacks renderUrl fields."""
    snapshot = {
        "runId": "render-state",
        "result": {
            "videos": [
                {
                    "index": 0,
                    "subject": "moon",
                    "header": "cheeseburger",
                    "status": "generated",
                    "assetUrl": "https://assets.example/moon.mp4",
                },
                {
                    "index": 1,
                    "subject": "sun",
                    "header": "pickle",
                    "status": "generated",
                    "assetUrl": "https://assets.example/sun.mp4",
                },
            ],
            "publishUrls": [],
        },
        "artifacts": [
            {
                "type": "render.url",
                "url": "https://shotstack.example/final.mp4",
                "metadata": {"persona": "alex"},
            }
        ],
    }

    monkeypatch.setattr(persona_nodes, "_get_run_snapshot", lambda _: snapshot, raising=False)
    state: RunState = {
        "run_id": "render-state",
        "project": "test_video_gen",
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("quinn", "test_video_gen")
    result = node(state)

    videos = result.get("videos") or []
    assert videos and all(video.get("renderUrl") == "https://shotstack.example/final.mp4" for video in videos)
    assert result.get("render_url") == "https://shotstack.example/final.mp4"


def test_persona_includes_production_tools_from_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    persona_nodes._TEST_ALLOWED_TOOLS["iggy"] = [  # type: ignore[index]
        "memory_search",
        "submit_generation_jobs_tool",
        "wait_for_generations_tool",
    ]

    state: RunState = {
        "run_id": "prod-tools",
        "project": "aismr",
        "input": "candles",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("iggy", "aismr")
    node(state)

    assert "submit_generation_jobs_tool" in FakeAgent.last_tools
    assert "wait_for_generations_tool" in FakeAgent.last_tools


def test_render_tool_returns_error_string(monkeypatch: pytest.MonkeyPatch) -> None:
    state: RunState = {"run_id": "render-error", "project": "test_video_gen"}
    tool = persona_nodes._build_render_video_timeline_tool(state, "alex", "test_video_gen")

    def boom(run_id, timeline=None, **_kwargs):  # noqa: ANN001
        raise ValueError("missing output block")

    monkeypatch.setattr(persona_nodes.persona_tools, "render_video_timeline_tool", boom)

    timeline = {
        "timeline": {
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {"type": "video", "src": "https://mock"},
                            "start": 0.0,
                            "length": 1.0,
                        }
                    ]
                }
            ]
        },
        "output": {"format": "mp4", "resolution": "hd"},
    }

    message = tool(timeline, run_id="render-error")
    assert "failed" in message.lower()
    assert "missing output block" in message


def test_render_tool_blocks_second_successful_call(monkeypatch: pytest.MonkeyPatch) -> None:
    state: RunState = {"run_id": "render-block", "project": "test_video_gen"}
    tool = persona_nodes._build_render_video_timeline_tool(state, "alex", "test_video_gen")

    calls: list[dict[str, Any]] = []

    def fake_render(run_id, timeline=None, **kwargs):  # noqa: ANN001
        calls.append({"run_id": run_id, "timeline": timeline, "kwargs": kwargs})
        return "Shotstack render submitted"

    monkeypatch.setattr(persona_nodes.persona_tools, "render_video_timeline_tool", fake_render)

    timeline = {
        "timeline": {
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {"type": "video", "src": "https://mock"},
                            "start": 0.0,
                            "length": 1.0,
                        }
                    ]
                }
            ]
        },
        "output": {"format": "mp4", "resolution": "hd"},
    }

    first = tool(timeline, run_id="render-block")
    second = tool(timeline, run_id="render-block")

    assert "submitted" in first.lower()
    assert "already" in second.lower()
    assert len(calls) == 1


def test_langchain_persona_handles_message_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyAgent:
        def __init__(self, tools=None, **__):  # noqa: ANN001
            self._tools = tools or []

        def invoke(self, payload):  # type: ignore[no-untyped-def]
            for tool in self._tools:
                if getattr(tool, "name", "") == "memory_search":
                    tool.invoke({"query": "dummy", "k": 5})
                    break
            class DummyMessage:
                def __init__(self, content: str) -> None:
                    self.content = content
                    self.tool_calls = [
                        {"name": "memory_search", "id": "call_1", "args": {"query": "dummy"}},
                    ]

            return {"messages": [DummyMessage("Agent output")]}

    monkeypatch.setattr(
        persona_nodes,
        "create_agent",
        lambda *_, tools=None, **__: DummyAgent(tools=tools),
        raising=False,
    )
    state: RunState = {
        "run_id": "message-handling",
        "project": "aismr",
        "input": "candles",
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("iggy", "aismr")
    result = node(state)
    transcript = result.get("transcript") or []
    assert transcript and "Agent output" in transcript[-1]


def test_persona_logs_and_drops_tools_outside_allowlist(caplog: pytest.LogCaptureFixture) -> None:
    """If code offers a tool not in persona allowlist, it is dropped and logged."""
    persona_nodes._TEST_ALLOWED_TOOLS["iggy"] = ["memory_search"]  # type: ignore[index]

    state: RunState = {
        "run_id": "test_video_gen-tools-restricted",
        "project": "test_video_gen",
        "input": "AI roommates",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }

    with caplog.at_level("WARNING", logger="myloware.orchestrator.persona_nodes"):
        node = persona_nodes.create_persona_node("iggy", "test_video_gen")
        _ = node(state)

    # Only memory_search should remain after allowlist filtering.
    assert FakeAgent.invocations == 1
    assert set(FakeAgent.last_tools) == {"memory_search"}

    # And the dropped tools should be called out in logs.
    records = [r for r in caplog.records if "Persona tools filtered by allowlist" in r.getMessage()]
    assert records, "Expected a warning log when tools are dropped by allowlist"
    dropped = getattr(records[-1], "dropped_tools", None)
    # Exact tool names depend on persona wiring; ensure at least one tool
    # was recorded as dropped by the allowlist.
    assert dropped is not None
    assert "memory_search" not in str(dropped)


def test_persona_injects_memory_search_when_allowlist_invalid_memory_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In memory_fallback mode, invalid allowlists inject memory_search for safety."""
    persona_nodes._TEST_ALLOWED_TOOLS["iggy"] = ["nonexistent_tool"]  # type: ignore[index]
    monkeypatch.setattr(persona_nodes.settings, "persona_allowlist_mode", "memory_fallback", raising=False)

    state: RunState = {
        "run_id": "test_video_gen-tools-empty",
        "project": "test_video_gen",
        "input": "AI roommates",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("iggy", "test_video_gen")
    node(state)
    tools_used = {tool.lower() for tool in FakeAgent.last_tools}
    assert "memory_search" in tools_used


def test_persona_missing_allowlist_defaults_to_memory_search_memory_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In memory_fallback mode, missing allowlists fall back to memory_search only."""
    persona_nodes._TEST_ALLOWED_TOOLS["iggy"] = []  # type: ignore[index]
    monkeypatch.setattr(persona_nodes.settings, "persona_allowlist_mode", "memory_fallback", raising=False)

    state: RunState = {
        "run_id": "missing-allowlist",
        "project": "aismr",
        "input": "candles",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }
    node = persona_nodes.create_persona_node("iggy", "aismr")
    node(state)
    assert set(FakeAgent.last_tools) == {"memory_search"}


def test_persona_invalid_allowlist_fail_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    """In fail_fast mode, invalid allowlists raise instead of injecting tools."""
    persona_nodes._TEST_ALLOWED_TOOLS["iggy"] = ["nonexistent_tool"]  # type: ignore[index]
    monkeypatch.setattr(persona_nodes.settings, "persona_allowlist_mode", "fail_fast", raising=False)

    state: RunState = {
        "run_id": "test_video_gen-tools-empty",
        "project": "test_video_gen",
        "input": "AI roommates",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("iggy", "test_video_gen")
    with pytest.raises(RuntimeError):
        node(state)


def test_persona_missing_allowlist_fail_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    """In fail_fast mode, missing allowlists raise loudly instead of injecting tools."""
    persona_nodes._TEST_ALLOWED_TOOLS["iggy"] = []  # type: ignore[index]
    monkeypatch.setattr(persona_nodes.settings, "persona_allowlist_mode", "fail_fast", raising=False)

    state: RunState = {
        "run_id": "missing-allowlist",
        "project": "aismr",
        "input": "candles",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }
    node = persona_nodes.create_persona_node("iggy", "aismr")
    with pytest.raises(RuntimeError):
        node(state)


def test_persona_never_receives_generation_tools_without_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    """submit_generation_jobs_tool stays off iggy unless explicitly allowed."""
    persona_nodes._TEST_ALLOWED_TOOLS["iggy"] = ["memory_search", "transfer_to_riley"]  # type: ignore[index]

    state: RunState = {
        "run_id": "iggy-no-submit",
        "project": "test_video_gen",
        "input": "Run",
        "videos": [],
        "transcript": [],
        "persona_history": [],
    }

    node = persona_nodes.create_persona_node("iggy", "test_video_gen")
    node(state)

    assert "submit_generation_jobs_tool" not in {tool.lower() for tool in FakeAgent.last_tools}


def test_compose_system_prompt_includes_project_specs() -> None:
    context = {
        "instructions": "Act on the storyboard notes from Iggy.",
        "materials": {
            "input": "Generate evidence clips",
            "videos": [
                {"index": 0, "subject": "moon", "header": "cheeseburger"},
                {"index": 1, "subject": "sun", "header": "pickle"},
            ],
        },
        "project_spec": {
            "specs": {
                "videos": [
                    {"subject": "moon", "header": "cheeseburger"},
                    {"subject": "sun", "header": "pickle"},
                ],
                "videoDuration": 8,
            }
        },
        "constraints": {"guardrails": {"summary": "Non-diegetic text via overlays only."}},
    }

    prompt = persona_nodes._compose_system_prompt("riley", context)
    assert "Objective" in prompt
    assert "moon" in prompt and "cheeseburger" in prompt
    assert "Project specs" in prompt and "videoDuration" in prompt
    assert "Guardrails summary" in prompt


def test_langchain_personas_disabled_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(persona_nodes.settings, "enable_langchain_personas", False, raising=False)
    state: RunState = {"run_id": "observer-only", "project": "test_video_gen", "transcript": [], "persona_history": []}
    node = persona_nodes.create_persona_node("riley", "test_video_gen")
    result = node(state)
    assert FakeAgent.invocations == 0
    assert result.get("current_persona") == "riley"


def test_langchain_personas_enabled_for_supported_project(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(persona_nodes.settings, "enable_langchain_personas", True, raising=False)
    state: RunState = {
        "run_id": "langchain-on",
        "project": "test_video_gen",
        "transcript": [],
        "persona_history": [],
    }
    node = persona_nodes.create_persona_node("riley", "test_video_gen")
    node(state)
    assert FakeAgent.invocations == 1, "LangChain agent should run for supported project when flag is true"
