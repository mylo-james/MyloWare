"""Unit tests for the LlamaStackBackend adapter."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from myloware.backends.llama_stack import LlamaStackBackend


def _response_with_choices(content: str):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def test_chat_text_returns_message_content():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _response_with_choices("hello")

    backend = LlamaStackBackend(sync_client=mock_client)
    out = backend.chat_text(messages=[{"role": "user", "content": "hi"}], model_id="m")
    assert out == "hello"


def test_chat_json_parses_object():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _response_with_choices('{"a": 1}')

    backend = LlamaStackBackend(sync_client=mock_client)
    data = backend.chat_json(messages=[{"role": "user", "content": "hi"}], model_id="m")

    assert data == {"a": 1}


def test_chat_json_raises_on_no_choices():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = SimpleNamespace(choices=[])

    backend = LlamaStackBackend(sync_client=mock_client)
    with pytest.raises(RuntimeError, match="no choices"):
        backend.chat_json(messages=[{"role": "user", "content": "hi"}], model_id="m")


def test_chat_json_raises_on_empty_content():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _response_with_choices("")

    backend = LlamaStackBackend(sync_client=mock_client)
    with pytest.raises(RuntimeError, match="empty content"):
        backend.chat_json(messages=[{"role": "user", "content": "hi"}], model_id="m")


def test_chat_json_raises_on_non_object_json():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _response_with_choices("[1, 2]")

    backend = LlamaStackBackend(sync_client=mock_client)
    with pytest.raises(RuntimeError, match="non-object JSON"):
        backend.chat_json(messages=[{"role": "user", "content": "hi"}], model_id="m")


def test_chat_json_raises_on_invalid_json():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _response_with_choices("not json")

    backend = LlamaStackBackend(sync_client=mock_client)
    with pytest.raises(Exception):
        backend.chat_json(messages=[{"role": "user", "content": "hi"}], model_id="m")


def test_chat_text_falls_back_to_response_content():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = SimpleNamespace(choices=[], content="direct")

    backend = LlamaStackBackend(sync_client=mock_client)
    out = backend.chat_text(messages=[{"role": "user", "content": "hi"}], model_id="m")
    assert out == "direct"


@pytest.mark.anyio
async def test_chat_json_async_parses_object():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_response_with_choices('{"ok": true}')
    )

    backend = LlamaStackBackend(async_client=mock_client)
    data = await backend.chat_json_async(messages=[{"role": "user", "content": "hi"}], model_id="m")

    assert data == {"ok": True}


@pytest.mark.anyio
async def test_chat_text_async_returns_message_content():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=_response_with_choices("hello"))

    backend = LlamaStackBackend(async_client=mock_client)
    out = await backend.chat_text_async(messages=[{"role": "user", "content": "hi"}], model_id="m")
    assert out == "hello"


@pytest.mark.anyio
async def test_chat_json_async_raises_on_no_choices():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=SimpleNamespace(choices=[]))

    backend = LlamaStackBackend(async_client=mock_client)
    with pytest.raises(RuntimeError, match="no choices"):
        await backend.chat_json_async(messages=[{"role": "user", "content": "hi"}], model_id="m")


@pytest.mark.anyio
async def test_chat_json_async_raises_on_empty_content():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=_response_with_choices(""))

    backend = LlamaStackBackend(async_client=mock_client)
    with pytest.raises(RuntimeError, match="empty content"):
        await backend.chat_json_async(messages=[{"role": "user", "content": "hi"}], model_id="m")


@pytest.mark.anyio
async def test_chat_json_async_raises_on_non_object_json():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=_response_with_choices("[1, 2]"))

    backend = LlamaStackBackend(async_client=mock_client)
    with pytest.raises(RuntimeError, match="non-object JSON"):
        await backend.chat_json_async(messages=[{"role": "user", "content": "hi"}], model_id="m")


@pytest.mark.anyio
async def test_check_content_safety_maps_fields(monkeypatch):
    async def fake_check(_client, _content: str, *, shield_id: str):  # type: ignore[no-untyped-def]
        return SimpleNamespace(safe=True, reason="ok", category="policy", severity="low")

    monkeypatch.setattr("myloware.safety.shields.check_content_safety", fake_check)

    backend = LlamaStackBackend(async_client=object())
    out = await backend.check_content_safety("hello")
    assert out.safe is True
    assert out.reason == "ok"
    assert out.category == "policy"
    assert out.severity == "low"


def test_search_vector_store_maps_hits():
    mock_client = MagicMock()
    mock_client.vector_stores.search.return_value = SimpleNamespace(
        data=[
            SimpleNamespace(filename="doc.md", score=0.9, content="hello", metadata={"k": "v"}),
            SimpleNamespace(filename=None, score=None, text="fallback", metadata=None),
        ]
    )

    backend = LlamaStackBackend(sync_client=mock_client)
    hits = backend.search_vector_store(vector_store_id="vs1", query="q", max_results=2)

    assert len(hits) == 2
    assert hits[0].filename == "doc.md"
    assert hits[0].score == 0.9
    assert hits[0].content == "hello"
    assert hits[0].metadata == {"k": "v"}
    assert hits[1].content == "fallback"
    assert hits[1].metadata == {}


def test_search_vector_store_includes_search_mode_and_ranking_options():
    mock_client = MagicMock()
    mock_client.vector_stores.search.return_value = SimpleNamespace(data=[])

    backend = LlamaStackBackend(sync_client=mock_client)
    backend.search_vector_store(
        vector_store_id="vs1",
        query="q",
        max_results=2,
        search_mode="hybrid",
        ranking_options={"ranker": {"type": "rrf", "impact_factor": 60.0}},
    )

    call_kwargs = mock_client.vector_stores.search.call_args.kwargs
    assert call_kwargs["search_mode"] == "hybrid"
    assert call_kwargs["ranking_options"]["ranker"]["type"] == "rrf"
