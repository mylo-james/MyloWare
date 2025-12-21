"""Unit tests for /v1/chat/supervisor."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from myloware.agents.classifier import ClassificationResult


@pytest.mark.anyio
async def test_chat_supervisor_returns_run_id(async_client, api_headers, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_async_llama_client,
        get_chat_session_repo,
        get_llama_client,
        get_vector_db_id,
    )

    deleted: list[str] = []

    class FakeConversations:
        def delete(self, conversation_id: str) -> None:
            deleted.append(conversation_id)

    fake_client = SimpleNamespace(conversations=FakeConversations())
    fake_async_client = SimpleNamespace()

    app.dependency_overrides[get_llama_client] = lambda: fake_client
    app.dependency_overrides[get_async_llama_client] = lambda: fake_async_client
    app.dependency_overrides[get_chat_session_repo] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    async def fake_classify_request_async(_backend, _msg):
        return ClassificationResult(intent="start_run", project="aismr", confidence=0.9)

    monkeypatch.setattr(
        "myloware.api.routes.chat.classify_request_async", fake_classify_request_async
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.extract_and_store_preference", lambda *_a, **_k: None
    )

    class FakeAgent:
        def create_session(self, _name: str) -> str:
            return "session-1"

    monkeypatch.setattr(
        "myloware.api.routes.chat.create_supervisor_agent", lambda *_a, **_k: FakeAgent()
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.create_turn_collecting_tool_responses",
        lambda *_a, **_k: (
            object(),
            [{"tool_name": "start_workflow", "content": {"run_id": "run-123"}}],
        ),
    )
    monkeypatch.setattr("myloware.api.routes.chat.extract_content", lambda _r: "hello")

    try:
        resp = await async_client.post(
            "/v1/chat/supervisor",
            headers=api_headers,
            json={"user_id": "u1", "message": "start a run"},
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["run_id"] == "run-123"
        assert payload["response"] == "hello"
        assert deleted == ["session-1"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_chat_supervisor_fails_closed_when_run_id_missing(
    async_client, api_headers, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_async_llama_client,
        get_chat_session_repo,
        get_llama_client,
        get_vector_db_id,
    )

    fake_client = SimpleNamespace(conversations=SimpleNamespace(delete=lambda **_k: None))
    fake_async_client = SimpleNamespace()

    app.dependency_overrides[get_llama_client] = lambda: fake_client
    app.dependency_overrides[get_async_llama_client] = lambda: fake_async_client
    app.dependency_overrides[get_chat_session_repo] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    async def fake_classify_request_async(_backend, _msg):
        return ClassificationResult(intent="start_run", project="aismr", confidence=0.9)

    monkeypatch.setattr(
        "myloware.api.routes.chat.classify_request_async", fake_classify_request_async
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.extract_and_store_preference", lambda *_a, **_k: None
    )

    class FakeAgent:
        def create_session(self, _name: str) -> str:
            return "session-1"

    monkeypatch.setattr(
        "myloware.api.routes.chat.create_supervisor_agent", lambda *_a, **_k: FakeAgent()
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.create_turn_collecting_tool_responses",
        lambda *_a, **_k: (object(), [{"tool_name": "start_workflow", "content": {"nope": True}}]),
    )
    monkeypatch.setattr("myloware.api.routes.chat.extract_content", lambda _r: "hello")

    try:
        resp = await async_client.post(
            "/v1/chat/supervisor",
            headers=api_headers,
            json={"user_id": "u1", "message": "start a run"},
        )
        assert resp.status_code == 500
        assert "did not return a run_id" in resp.json()["detail"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_chat_supervisor_streaming_returns_sse(
    async_client, api_headers, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_async_llama_client,
        get_chat_session_repo,
        get_llama_client,
        get_vector_db_id,
    )

    fake_client = SimpleNamespace()

    class FakeChunk:
        def __init__(self, text: str):
            delta = SimpleNamespace(content=text)
            choice = SimpleNamespace(delta=delta, message=None)
            self.choices = [choice]

    async def fake_stream():
        yield FakeChunk("hi")
        yield FakeChunk("there")

    class FakeAsyncChat:
        class completions:
            @staticmethod
            async def create(**_kwargs):
                async for item in fake_stream():
                    yield item

    fake_async_client = SimpleNamespace(chat=FakeAsyncChat())

    app.dependency_overrides[get_llama_client] = lambda: fake_client
    app.dependency_overrides[get_async_llama_client] = lambda: fake_async_client
    app.dependency_overrides[get_chat_session_repo] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    async def fake_classify_request_async(_backend, _msg):
        return ClassificationResult(intent="help", project=None, confidence=0.9)

    monkeypatch.setattr(
        "myloware.api.routes.chat.classify_request_async", fake_classify_request_async
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.extract_and_store_preference", lambda *_a, **_k: None
    )

    app.state.default_model = "meta-llama/Llama-3.2-3B-Instruct"

    try:
        async with async_client.stream(
            "POST",
            "/v1/chat/supervisor?stream=true",
            headers=api_headers,
            json={"user_id": "u1", "message": "hello"},
        ) as resp:
            assert resp.status_code == 200
            body = await resp.aread()
            assert b"data: hi" in body
            assert b"data: there" in body
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_chat_supervisor_parses_run_id_from_json_string(
    async_client, api_headers, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_async_llama_client,
        get_chat_session_repo,
        get_llama_client,
        get_vector_db_id,
    )

    fake_client = SimpleNamespace(conversations=SimpleNamespace(delete=lambda **_k: None))
    fake_async_client = SimpleNamespace()

    app.dependency_overrides[get_llama_client] = lambda: fake_client
    app.dependency_overrides[get_async_llama_client] = lambda: fake_async_client
    app.dependency_overrides[get_chat_session_repo] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    async def fake_classify_request_async(_backend, _msg):
        return ClassificationResult(intent="start_run", project="aismr", confidence=0.9)

    monkeypatch.setattr(
        "myloware.api.routes.chat.classify_request_async", fake_classify_request_async
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.extract_and_store_preference", lambda *_a, **_k: None
    )

    class FakeAgent:
        def create_session(self, _name: str) -> str:
            return "session-1"

    tool_responses = [
        {"tool_name": "not_it", "content": {"run_id": "nope"}},
        {"tool_name": "start_workflow", "content": "{not json"},
        {"tool_name": "start_workflow", "content": '{"run_id": "run-456"}'},
    ]

    monkeypatch.setattr(
        "myloware.api.routes.chat.create_supervisor_agent", lambda *_a, **_k: FakeAgent()
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.create_turn_collecting_tool_responses",
        lambda *_a, **_k: (object(), tool_responses),
    )
    monkeypatch.setattr("myloware.api.routes.chat.extract_content", lambda _r: "hello")

    try:
        resp = await async_client.post(
            "/v1/chat/supervisor",
            headers=api_headers,
            json={"user_id": "u1", "message": "start a run"},
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["run_id"] == "run-456"
        assert payload["response"] == "hello"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_chat_supervisor_falls_back_to_sync_classification_and_cleanup_failure_is_swallowed(
    async_client, api_headers, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_async_llama_client,
        get_chat_session_repo,
        get_llama_client,
        get_vector_db_id,
    )

    def boom_delete(**_k) -> None:  # type: ignore[no-untyped-def]
        raise RuntimeError("cleanup failed")

    fake_client = SimpleNamespace(conversations=SimpleNamespace(delete=boom_delete))
    fake_async_client = SimpleNamespace()

    app.dependency_overrides[get_llama_client] = lambda: fake_client
    app.dependency_overrides[get_async_llama_client] = lambda: fake_async_client
    app.dependency_overrides[get_chat_session_repo] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    async def fake_classify_request_async(_backend, _msg):
        raise RuntimeError("no async")

    def fake_classify_request(_backend, _msg):
        return ClassificationResult(
            intent="start_run",
            project="aismr",
            run_id="r1",
            gate="ideation",
            custom_object="candles",
            confidence=0.9,
        )

    monkeypatch.setattr(
        "myloware.api.routes.chat.classify_request_async", fake_classify_request_async
    )
    monkeypatch.setattr("myloware.api.routes.chat.classify_request", fake_classify_request)
    monkeypatch.setattr(
        "myloware.api.routes.chat.extract_and_store_preference",
        lambda *_a, **_k: (_ for _ in ()).throw(AttributeError("no memory")),
    )

    seen: dict[str, str] = {}

    class FakeAgent:
        def create_session(self, _name: str) -> str:
            return "session-1"

    def fake_turn(_agent, messages, _session_id):  # type: ignore[no-untyped-def]
        seen["content"] = messages[0]["content"]
        return (object(), [{"tool_name": "start_workflow", "content": {"run_id": "run-123"}}])

    monkeypatch.setattr(
        "myloware.api.routes.chat.create_supervisor_agent", lambda *_a, **_k: FakeAgent()
    )
    monkeypatch.setattr("myloware.api.routes.chat.create_turn_collecting_tool_responses", fake_turn)
    monkeypatch.setattr("myloware.api.routes.chat.extract_content", lambda _r: "hello")

    try:
        resp = await async_client.post(
            "/v1/chat/supervisor",
            headers=api_headers,
            json={"user_id": "u1", "message": "start a run"},
        )
        assert resp.status_code == 200
        assert resp.json()["run_id"] == "run-123"
        assert "[run_id=r1]" in seen["content"]
        assert "[gate=ideation]" in seen["content"]
        assert "[object=candles]" in seen["content"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_chat_supervisor_streaming_uses_message_content_when_delta_missing(
    async_client, api_headers, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_async_llama_client,
        get_chat_session_repo,
        get_llama_client,
        get_vector_db_id,
    )

    fake_client = SimpleNamespace()

    class FakeChunk:
        def __init__(self, text: str):
            delta = SimpleNamespace(content=None)
            message = SimpleNamespace(content=text)
            choice = SimpleNamespace(delta=delta, message=message)
            self.choices = [choice]

    async def fake_stream():
        yield FakeChunk("hi")

    class FakeAsyncChat:
        class completions:
            @staticmethod
            async def create(**_kwargs):
                async for item in fake_stream():
                    yield item

    fake_async_client = SimpleNamespace(chat=FakeAsyncChat())

    app.dependency_overrides[get_llama_client] = lambda: fake_client
    app.dependency_overrides[get_async_llama_client] = lambda: fake_async_client
    app.dependency_overrides[get_chat_session_repo] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    async def fake_classify_request_async(_backend, _msg):
        return ClassificationResult(intent="help", project=None, confidence=0.9)

    monkeypatch.setattr(
        "myloware.api.routes.chat.classify_request_async", fake_classify_request_async
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.extract_and_store_preference", lambda *_a, **_k: None
    )

    app.state.default_model = "meta-llama/Llama-3.2-3B-Instruct"

    try:
        async with async_client.stream(
            "POST",
            "/v1/chat/supervisor?stream=true",
            headers=api_headers,
            json={"user_id": "u1", "message": "hello"},
        ) as resp:
            assert resp.status_code == 200
            body = await resp.aread()
            assert b"data: hi" in body
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_chat_supervisor_streaming_emits_stream_error_on_exception(
    async_client, api_headers, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_async_llama_client,
        get_chat_session_repo,
        get_llama_client,
        get_vector_db_id,
    )

    fake_client = SimpleNamespace()

    class FakeAsyncChat:
        class completions:
            @staticmethod
            async def create(**_kwargs):
                raise RuntimeError("boom")
                if False:  # pragma: no cover - keep this as an async generator
                    yield None

    fake_async_client = SimpleNamespace(chat=FakeAsyncChat())

    app.dependency_overrides[get_llama_client] = lambda: fake_client
    app.dependency_overrides[get_async_llama_client] = lambda: fake_async_client
    app.dependency_overrides[get_chat_session_repo] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    async def fake_classify_request_async(_backend, _msg):
        return ClassificationResult(intent="help", project=None, confidence=0.9)

    monkeypatch.setattr(
        "myloware.api.routes.chat.classify_request_async", fake_classify_request_async
    )
    monkeypatch.setattr(
        "myloware.api.routes.chat.extract_and_store_preference", lambda *_a, **_k: None
    )

    app.state.default_model = "meta-llama/Llama-3.2-3B-Instruct"

    try:
        async with async_client.stream(
            "POST",
            "/v1/chat/supervisor?stream=true",
            headers=api_headers,
            json={"user_id": "u1", "message": "hello"},
        ) as resp:
            assert resp.status_code == 200
            body = await resp.aread()
            assert b"stream-error" in body
    finally:
        app.dependency_overrides.clear()
