from __future__ import annotations

import copy

import pytest

from apps.orchestrator import persona_nodes


def _build_videos(count: int, subject: str, header_prefix: str) -> list[dict[str, object]]:
    videos: list[dict[str, object]] = []
    for idx in range(count):
        videos.append(
            {
                "index": idx,
                "subject": subject,
                "header": f"{header_prefix} {idx + 1}",
                "status": "generated",
                "prompt": f"{header_prefix} prompt {idx + 1}",
                "assetUrl": f"https://assets.example/{header_prefix.lower()}/{idx}.mp4",
            }
        )
    return videos


@pytest.fixture(autouse=True)
def patch_run_snapshots(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_snapshot(run_id: str) -> dict[str, object]:
        normalized = run_id.lower()
        if "aismr" in normalized:
            videos = _build_videos(12, "candle", "Variant")
        else:
            videos = _build_videos(2, "subject", "Scene")
        publish_urls = [f"https://publish.example/{run_id}/{idx}" for idx in range(len(videos))]
        return {
            "runId": run_id,
            "result": {"videos": videos, "publishUrls": publish_urls},
            "artifacts": [],
        }

    monkeypatch.setattr(
        persona_nodes,
        "_get_run_snapshot",
        lambda run_id: copy.deepcopy(fake_snapshot(str(run_id))),
        raising=False,
    )


@pytest.fixture(autouse=True)
def patch_langchain_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeLLM:
        def __init__(self, *args, **kwargs) -> None:  # noqa: ANN001
            self.args = args
            self.kwargs = kwargs

    class _FakeMessage:
        def __init__(self, content: str, tool_calls: list[dict[str, str]]) -> None:
            self.content = content
            self.tool_calls = tool_calls

    class _FakeAgent:
        def __init__(self, tools=None, **kwargs):  # type: ignore[no-untyped-def]
            self.tools = tools or []
            self.kwargs = kwargs

        def invoke(self, payload, config=None):  # type: ignore[no-untyped-def]
            tool_calls = []
            for tool in self.tools or []:
                tool_name = getattr(tool, "name", None)
                if tool_name:
                    tool_calls.append({"name": tool_name})
            return {"messages": [_FakeMessage("persona step completed", tool_calls)]}

    def _fake_create_agent(*, model, tools, system_prompt):  # noqa: ANN001
        return _FakeAgent(tools=tools, system_prompt=system_prompt, model=model)

    monkeypatch.setattr(persona_nodes, "ChatOpenAI", lambda *a, **k: _FakeLLM(*a, **k), raising=False)
    monkeypatch.setattr(persona_nodes, "create_agent", _fake_create_agent, raising=False)
    monkeypatch.setattr(persona_nodes, "LANGCHAIN_AVAILABLE", True, raising=False)
