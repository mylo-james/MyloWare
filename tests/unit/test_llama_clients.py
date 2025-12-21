"""Unit tests for myloware.llama_clients helpers."""

from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.fixture(autouse=True)
def _clear_client_cache():
    from myloware.llama_clients import clear_client_cache

    clear_client_cache()
    yield
    clear_client_cache()


def test_get_sync_client_returns_resilient_client_when_enabled(monkeypatch) -> None:
    from myloware import llama_clients as mod

    monkeypatch.setattr(mod.settings, "llama_stack_url", "http://localhost:1234")
    monkeypatch.setattr(mod.settings, "circuit_breaker_enabled", True)
    monkeypatch.setattr(mod.settings, "circuit_breaker_failure_threshold", 1)
    monkeypatch.setattr(mod.settings, "circuit_breaker_recovery_timeout", 1.0)

    fake_client = object()
    monkeypatch.setattr(mod, "LlamaStackClient", lambda **_k: fake_client)

    client = mod.get_sync_client()
    assert isinstance(client, mod.ResilientClient)
    assert client._client is fake_client  # type: ignore[attr-defined]


def test_get_sync_client_returns_raw_client_when_disabled(monkeypatch) -> None:
    from myloware import llama_clients as mod

    monkeypatch.setattr(mod.settings, "llama_stack_url", "http://localhost:1234")
    monkeypatch.setattr(mod.settings, "circuit_breaker_enabled", False)

    fake_client = object()
    monkeypatch.setattr(mod, "LlamaStackClient", lambda **_k: fake_client)

    client = mod.get_sync_client()
    assert client is fake_client


def test_get_async_client_is_cached(monkeypatch) -> None:
    from myloware import llama_clients as mod

    monkeypatch.setattr(mod.settings, "llama_stack_url", "http://localhost:1234")

    created: list[object] = []

    def fake_async_client(**_k):
        obj = object()
        created.append(obj)
        return obj

    monkeypatch.setattr(mod, "AsyncLlamaStackClient", fake_async_client)

    c1 = mod.get_async_client()
    c2 = mod.get_async_client()
    assert c1 is c2
    assert len(created) == 1


@pytest.mark.anyio
async def test_async_chat_complete_and_stream(monkeypatch) -> None:
    from myloware.llama_clients import async_chat_complete

    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="hello"))])

    async def create(**_k):
        return response

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=create),
        )
    )

    result = await async_chat_complete(
        messages=[{"role": "user", "content": "x"}], client=fake_client
    )
    assert result == "hello"


@pytest.mark.anyio
async def test_async_chat_complete_stream_returns_iterator() -> None:
    from myloware.llama_clients import async_chat_complete

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **_k: None))
    )
    it = await async_chat_complete(
        messages=[{"role": "user", "content": "x"}],
        client=fake_client,
        stream=True,
    )
    assert hasattr(it, "__aiter__")


@pytest.mark.anyio
async def test_async_chat_stream_yields_delta_chunks(monkeypatch) -> None:
    from myloware.llama_clients import async_chat_stream

    class FakeChunk:
        def __init__(self, text: str):
            delta = SimpleNamespace(content=text)
            self.choices = [SimpleNamespace(delta=delta, message=None)]

    async def fake_stream():
        yield FakeChunk("a")
        yield FakeChunk("b")

    async def create(**_k):
        return fake_stream()

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    out = []
    async for part in async_chat_stream(
        messages=[{"role": "user", "content": "x"}], client=fake_client
    ):
        out.append(part)
    assert out == ["a", "b"]


def test_list_models_and_verify_connection(monkeypatch) -> None:
    from myloware import llama_clients as mod

    models = [SimpleNamespace(identifier="m1")]
    fake_client = SimpleNamespace(
        models=SimpleNamespace(list=lambda: models),
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=lambda **_k: SimpleNamespace(
                    choices=[SimpleNamespace(message=SimpleNamespace(content="hello"))]
                )
            )
        ),
    )

    assert mod.list_models(fake_client) == ["m1"]
    result = mod.verify_connection(fake_client)
    assert result["success"] is True
    assert result["inference_works"] is True


def test_verify_connection_handles_no_models(monkeypatch) -> None:
    from myloware import llama_clients as mod

    fake_client = SimpleNamespace(models=SimpleNamespace(list=lambda: []))
    monkeypatch.setattr(mod, "list_models", lambda _c: [])
    result = mod.verify_connection(fake_client)
    assert result["success"] is False
    assert result["error"] == "No models available"
