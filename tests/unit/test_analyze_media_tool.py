"""Unit tests for AnalyzeMediaTool."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from myloware.storage.models import ArtifactType


def _fake_openai_client(create_impl):
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_impl)))


def _patch_session_factory(monkeypatch, *, session, artifacts=None, created=None):
    artifacts = artifacts or []
    created = created if created is not None else []

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def get_by_run_async(self, _run_id):
            return artifacts

        async def create_async(self, **kwargs):
            created.append(kwargs)

    @asynccontextmanager
    async def fake_session_cm():
        yield session

    monkeypatch.setattr(
        "myloware.tools.analyze_media.get_async_session_factory", lambda: lambda: fake_session_cm()
    )
    monkeypatch.setattr("myloware.tools.analyze_media.ArtifactRepository", FakeRepo)
    return created


def test_analyze_media_tool_requires_api_key(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    # Ensure this test is not affected by a developer's shell env.
    monkeypatch.setattr("myloware.tools.analyze_media.settings.openai_api_key", None, raising=False)

    with pytest.raises(ValueError, match="OpenAI API key required"):
        AnalyzeMediaTool(run_id=None, api_key=None)


def test_analyze_media_cache_key_is_stable(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    tool = AnalyzeMediaTool(run_id=None, api_key="test")
    k1 = tool._compute_cache_key("https://example.com/x.png", "full")
    k2 = tool._compute_cache_key("https://example.com/x.png", "full")
    k3 = tool._compute_cache_key("https://example.com/x.png", "colors")
    assert k1 == k2
    assert k1 != k3


def test_analyze_media_tool_metadata_helpers(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    tool = AnalyzeMediaTool(run_id=None, api_key="test")
    assert tool.get_name() == "analyze_media"
    assert "Analyze images" in tool.get_description()
    schema = tool.get_input_schema()
    assert schema["type"] == "object"
    assert "media_url" in schema["properties"]


@pytest.mark.anyio
async def test_check_cache_returns_none_without_run_id(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    tool = AnalyzeMediaTool(run_id=None, api_key="test")
    assert await tool._check_cache("k") is None


@pytest.mark.anyio
async def test_check_cache_returns_cached_result(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    run_id = str(uuid4())
    tool = AnalyzeMediaTool(run_id=run_id, api_key="test")
    cache_key = tool._compute_cache_key("https://example.com/x.png", "full")
    cached_result = {"analysis": "cached"}

    artifact = SimpleNamespace(
        artifact_type=ArtifactType.VISION_ANALYSIS.value,
        artifact_metadata={"cache_key": cache_key, "media_url": "https://example.com/x.png"},
        content=json.dumps(cached_result),
    )

    session = SimpleNamespace()
    _patch_session_factory(monkeypatch, session=session, artifacts=[artifact])

    found = await tool._check_cache(cache_key)
    assert found == cached_result


@pytest.mark.anyio
async def test_check_cache_returns_none_when_cache_empty(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    run_id = str(uuid4())
    tool = AnalyzeMediaTool(run_id=run_id, api_key="test")
    session = SimpleNamespace()
    _patch_session_factory(monkeypatch, session=session, artifacts=[])
    assert await tool._check_cache("k") is None


@pytest.mark.anyio
async def test_check_cache_handles_bad_json(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    run_id = str(uuid4())
    tool = AnalyzeMediaTool(run_id=run_id, api_key="test")
    cache_key = tool._compute_cache_key("https://example.com/x.png", "full")

    artifact = SimpleNamespace(
        artifact_type=ArtifactType.VISION_ANALYSIS.value,
        artifact_metadata={"cache_key": cache_key},
        content="{not json",
    )

    session = SimpleNamespace()
    _patch_session_factory(monkeypatch, session=session, artifacts=[artifact])

    assert await tool._check_cache(cache_key) is None


@pytest.mark.anyio
async def test_store_cache_noops_without_run_id(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    tool = AnalyzeMediaTool(run_id=None, api_key="test")
    await tool._store_cache("k", "u", "full", {"analysis": "x"})


@pytest.mark.anyio
async def test_store_cache_persists_artifact(monkeypatch) -> None:
    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    from myloware.tools.analyze_media import AnalyzeMediaTool

    run_id = str(uuid4())
    tool = AnalyzeMediaTool(run_id=run_id, api_key="test")

    session = SimpleNamespace(commit=AsyncMock())
    created = _patch_session_factory(monkeypatch, session=session, artifacts=[])

    await tool._store_cache("k", "u", "full", {"analysis": "x"})

    assert session.commit.await_count == 1
    assert created
    assert created[0]["artifact_type"] == ArtifactType.VISION_ANALYSIS
    assert created[0]["metadata"]["cache_key"] == "k"


@pytest.mark.anyio
async def test_async_run_impl_returns_cached_result(monkeypatch) -> None:
    from myloware.tools.analyze_media import AnalyzeMediaTool

    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    tool = AnalyzeMediaTool(run_id=str(uuid4()), api_key="test")

    monkeypatch.setattr(tool, "_check_cache", AsyncMock(return_value={"analysis": "cached"}))
    tool.openai_client = _fake_openai_client(
        create_impl=AsyncMock(side_effect=AssertionError("should not call"))
    )

    result = await tool.async_run_impl("https://example.com/x.png", analysis_type="full")
    assert result["success"] is True
    assert result["cached"] is True
    assert result["analysis"] == "cached"


@pytest.mark.anyio
async def test_async_run_impl_calls_openai_and_stores_cache(monkeypatch) -> None:
    from myloware.tools.analyze_media import AnalyzeMediaTool

    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    tool = AnalyzeMediaTool(run_id=str(uuid4()), api_key="test")

    monkeypatch.setattr(tool, "_check_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(tool, "_store_cache", AsyncMock())

    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="analysis text"))],
        usage=SimpleNamespace(total_tokens=10),
    )
    tool.openai_client = _fake_openai_client(create_impl=AsyncMock(return_value=response))

    result = await tool.async_run_impl(
        "https://example.com/x.png",
        analysis_type="colors",
        editing_context="Pick overlay style",
    )

    assert result["success"] is True
    assert result["analysis"] == "analysis text"
    assert result["analysis_type"] == "colors"
    tool._store_cache.assert_awaited_once()


@pytest.mark.anyio
async def test_async_run_impl_returns_structured_error(monkeypatch) -> None:
    from myloware.tools.analyze_media import AnalyzeMediaTool

    monkeypatch.setattr("myloware.tools.analyze_media.AsyncOpenAI", lambda api_key: object())
    tool = AnalyzeMediaTool(run_id=str(uuid4()), api_key="test")

    monkeypatch.setattr(tool, "_check_cache", AsyncMock(return_value=None))
    tool.openai_client = _fake_openai_client(
        create_impl=AsyncMock(side_effect=RuntimeError("boom"))
    )

    result = await tool.async_run_impl("https://example.com/x.png", analysis_type="full")
    assert result["success"] is False
    assert result["error"]["code"] == "analysis_failed"
    assert "boom" in result["error"]["message"]
