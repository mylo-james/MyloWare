"""Unit tests for Telegram webhook routes."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.anyio
async def test_seen_recently_is_idempotent(monkeypatch) -> None:
    import asyncio
    from cachetools import TTLCache

    from myloware.api.routes import telegram as mod

    # Isolate global cache/lock for deterministic tests.
    monkeypatch.setattr(mod, "_idempotency_cache", TTLCache(maxsize=10, ttl=60))
    monkeypatch.setattr(mod, "_idempotency_lock", asyncio.Lock())

    assert await mod._seen_recently("k") is False
    assert await mod._seen_recently("k") is True


def test_build_message_key_prefers_update_id() -> None:
    from myloware.api.routes.telegram import _build_message_key

    assert _build_message_key({"update_id": 123}, "c", {"message_id": 9}) == "update:123"
    assert _build_message_key({}, "c", {"message_id": 9}) == "chat:c:message:9"
    assert _build_message_key({}, "c", {}) is None


@pytest.mark.anyio
async def test_send_telegram_message_returns_false_without_token(monkeypatch) -> None:
    from myloware.api.routes.telegram import send_telegram_message
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_bot_token", None)
    ok = await send_telegram_message("1", "hi", client=SimpleNamespace())
    assert ok is False


@pytest.mark.anyio
async def test_send_telegram_message_success_with_client(monkeypatch) -> None:
    from myloware.api.routes.telegram import send_telegram_message
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_bot_token", "token")

    class FakeResp:
        def raise_for_status(self):
            return None

    class FakeClient:
        async def post(self, *_a, **_k):
            return FakeResp()

    ok = await send_telegram_message("1", "hi", client=FakeClient())
    assert ok is True


@pytest.mark.anyio
async def test_send_telegram_message_handles_exception(monkeypatch) -> None:
    from myloware.api.routes.telegram import send_telegram_message
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_bot_token", "token")

    class FakeClient:
        async def post(self, *_a, **_k):
            raise RuntimeError("fail")

    ok = await send_telegram_message("1", "hi", client=FakeClient())
    assert ok is False


@pytest.mark.anyio
async def test_send_telegram_message_uses_internal_client(monkeypatch) -> None:
    from myloware.api.routes.telegram import send_telegram_message
    from myloware.config import settings
    from myloware.api.routes import telegram as mod

    monkeypatch.setattr(settings, "telegram_bot_token", "token")

    class FakeResp:
        def raise_for_status(self):
            return None

    class FakeClient:
        async def post(self, *_a, **_k):
            return FakeResp()

    class FakeClientCM:
        async def __aenter__(self):
            return FakeClient()

        async def __aexit__(self, exc_type, exc, tb):
            return None

    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda *a, **k: FakeClientCM())

    ok = await send_telegram_message("1", "hi")
    assert ok is True


@pytest.mark.anyio
async def test_answer_callback_posts_when_token_set(monkeypatch) -> None:
    from myloware.api.routes import telegram as mod
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_bot_token", "token")

    posted: list[dict[str, object]] = []

    class FakeClient:
        async def post(self, url, json):  # type: ignore[no-untyped-def]
            posted.append({"url": url, "json": json})

    class FakeClientCM:
        async def __aenter__(self):
            return FakeClient()

        async def __aexit__(self, exc_type, exc, tb):
            return None

    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda *a, **k: FakeClientCM())

    await mod._answer_callback("cb", "ok")
    assert posted


@pytest.mark.anyio
async def test_telegram_webhook_rejects_invalid_secret(async_client, monkeypatch) -> None:
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_webhook_secret", "secret")
    monkeypatch.setattr(settings, "telegram_allow_all_chats", True)

    resp = await async_client.post(
        "/v1/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
        json={
            "update_id": 1,
            "message": {"text": "hi", "message_id": 1, "chat": {"id": 1, "username": "u"}},
        },
    )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_telegram_webhook_allows_chat_and_sends_reply(async_client, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import get_llama_client
    from myloware.api.routes import telegram as mod
    from myloware.config import settings

    # Allow all chats for this test.
    monkeypatch.setattr(settings, "telegram_webhook_secret", None)
    monkeypatch.setattr(settings, "telegram_allow_all_chats", True)
    monkeypatch.setattr(settings, "telegram_allowed_chat_ids", [])

    # Avoid real network calls.
    async def fake_send(_chat_id: str, _text: str, **_k):
        return True

    monkeypatch.setattr(mod, "send_telegram_message", fake_send)

    class FakeSupervisor:
        def create_session(self, _name: str):
            return "conv-1"

        def create_turn(self, messages, session_id):  # noqa: ARG002 - signature compatibility
            return SimpleNamespace(
                completion_message=SimpleNamespace(content="pong"),
            )

    monkeypatch.setattr(mod, "create_supervisor_agent", lambda *_a, **_k: FakeSupervisor())

    deleted: list[str] = []

    class FakeConversations:
        def delete(self, conversation_id: str):
            deleted.append(conversation_id)

    fake_client = SimpleNamespace(conversations=FakeConversations())
    app.dependency_overrides[get_llama_client] = lambda: fake_client

    # Reset idempotency to avoid cross-test interference.
    import asyncio
    from cachetools import TTLCache

    mod._idempotency_cache = TTLCache(maxsize=10, ttl=60)
    mod._idempotency_lock = asyncio.Lock()

    try:
        resp = await async_client.post(
            "/v1/telegram/webhook",
            json={
                "update_id": 123,
                "message": {
                    "text": "hi",
                    "message_id": 1,
                    "chat": {"id": 42, "username": "u"},
                },
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert deleted == ["conv-1"]

        # Duplicate update should be ignored.
        resp2 = await async_client.post(
            "/v1/telegram/webhook",
            json={
                "update_id": 123,
                "message": {
                    "text": "hi",
                    "message_id": 1,
                    "chat": {"id": 42, "username": "u"},
                },
            },
        )
        assert resp2.status_code == 200
        assert resp2.json()["status"] == "ignored"
        assert resp2.json()["reason"] == "duplicate"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_telegram_webhook_requires_secret_in_production(async_client, monkeypatch) -> None:
    from myloware.config import settings

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "telegram_webhook_secret", None)
    monkeypatch.setattr(settings, "telegram_allow_all_chats", True)

    resp = await async_client.post(
        "/v1/telegram/webhook",
        json={
            "update_id": 1,
            "message": {"text": "hi", "message_id": 1, "chat": {"id": 1}},
        },
    )
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_telegram_webhook_invalid_json(async_client, monkeypatch) -> None:
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_allow_all_chats", True)
    resp = await async_client.post(
        "/v1/telegram/webhook",
        content="not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_telegram_webhook_cleanup_failure_is_swallowed(async_client, monkeypatch) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import get_llama_client
    from myloware.api.routes import telegram as mod
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_allow_all_chats", True)
    monkeypatch.setattr(settings, "telegram_webhook_secret", None)

    async def fake_send(*_a, **_k):
        return True

    monkeypatch.setattr(mod, "send_telegram_message", fake_send)

    class FakeSupervisor:
        def create_session(self, _name: str):
            return "conv-2"

        def create_turn(self, messages, session_id):  # noqa: ARG002
            return SimpleNamespace(completion_message=SimpleNamespace(content="ok"))

    monkeypatch.setattr(mod, "create_supervisor_agent", lambda *_a, **_k: FakeSupervisor())

    class BadConversations:
        def delete(self, conversation_id: str):  # noqa: ARG002
            raise RuntimeError("fail")

    fake_client = SimpleNamespace(conversations=BadConversations())
    app.dependency_overrides[get_llama_client] = lambda: fake_client

    try:
        resp = await async_client.post(
            "/v1/telegram/webhook",
            json={
                "update_id": 999,
                "message": {
                    "text": "hi",
                    "message_id": 2,
                    "chat": {"id": 42, "username": "u"},
                },
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_telegram_callback_invalid_data(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod

    answered = {"n": 0}

    async def answer(_callback_id, _text):
        answered["n"] += 1

    monkeypatch.setattr(mod, "_answer_callback", answer)

    resp = await async_client.post(
        "/v1/telegram/callback",
        json={"callback_query": {"id": "cb", "data": "bad", "message": {"chat": {"id": 1}}}},
    )
    assert resp.status_code == 200
    assert resp.json()["error"] == "invalid_callback"
    assert answered["n"] == 1


@pytest.mark.anyio
async def test_telegram_callback_invalid_json(async_client) -> None:
    resp = await async_client.post(
        "/v1/telegram/callback",
        content="not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_telegram_callback_missing_query_returns_ok(async_client) -> None:
    resp = await async_client.post("/v1/telegram/callback", json={})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.anyio
async def test_telegram_callback_approve_ideation(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod

    run_id = uuid4()

    async def send_message(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "TelegramNotifier", lambda: SimpleNamespace(send_message=send_message))

    async def fake_resume_hitl_gate(
        run_uuid, gate: str, *, approved: bool, comment=None, data=None
    ):
        assert run_uuid == run_id
        assert gate == "ideation"
        assert approved is True
        return SimpleNamespace(status="ok", current_step="next")

    monkeypatch.setattr(mod, "resume_hitl_gate", fake_resume_hitl_gate)

    async def answer(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)

    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": f"approve:{run_id}:ideation",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.anyio
async def test_telegram_callback_reject_path(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod

    run_id = uuid4()

    async def send_message(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "TelegramNotifier", lambda: SimpleNamespace(send_message=send_message))

    async def fake_resume_hitl_gate(
        run_uuid, gate: str, *, approved: bool, comment=None, data=None
    ):
        assert run_uuid == run_id
        assert gate == "publish"
        assert approved is False
        return SimpleNamespace(status="rejected")

    monkeypatch.setattr(mod, "resume_hitl_gate", fake_resume_hitl_gate)

    async def answer(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)

    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": f"reject:{run_id}:publish",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.anyio
async def test_telegram_callback_reject_unknown_gate(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod

    called = {"n": 0}

    async def answer(*_a, **_k):
        called["n"] += 1

    monkeypatch.setattr(mod, "_answer_callback", answer)

    run_id = uuid4()
    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": f"reject:{run_id}:unknown",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["error"] == "unknown_gate"
    assert called["n"] == 1


@pytest.mark.anyio
async def test_telegram_callback_db_dispatcher_handles_commit_and_enqueue_errors(
    async_client, monkeypatch
) -> None:
    from myloware.api.server import app
    from myloware.api.dependencies import (
        get_artifact_repo,
        get_llama_client,
        get_run_repo,
        get_vector_db_id,
    )
    from myloware.api.routes import telegram as mod
    from myloware.config import settings

    class FakeSession:
        def commit(self):
            raise RuntimeError("db")

    class FakeRunRepo:
        def __init__(self):
            self.session = FakeSession()

    class FakeArtifactRepo:
        pass

    async def answer(*_a, **_k):
        return None

    async def send_message(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)
    monkeypatch.setattr(mod, "TelegramNotifier", lambda: SimpleNamespace(send_message=send_message))
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    async def raise_enqueue(self, *_a, **_k):  # type: ignore[no-untyped-def]
        raise ValueError("duplicate")

    monkeypatch.setattr("myloware.storage.repositories.JobRepository.enqueue_async", raise_enqueue)

    app.dependency_overrides[get_run_repo] = lambda: FakeRunRepo()
    app.dependency_overrides[get_artifact_repo] = lambda: FakeArtifactRepo()
    app.dependency_overrides[get_llama_client] = lambda: SimpleNamespace()
    app.dependency_overrides[get_vector_db_id] = lambda: "kb"

    run_id = uuid4()
    try:
        resp = await async_client.post(
            "/v1/telegram/callback",
            json={
                "callback_query": {
                    "id": "cb",
                    "data": f"approve:{run_id}:ideation",
                    "message": {"chat": {"id": 1}},
                }
            },
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_telegram_webhook_missing_message_or_chat(async_client, monkeypatch) -> None:
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_allow_all_chats", True)
    resp = await async_client.post(
        "/v1/telegram/webhook",
        json={"update_id": 1, "message": {"text": "", "message_id": 1, "chat": {}}},
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_telegram_webhook_chat_not_allowed(async_client, monkeypatch) -> None:
    from myloware.config import settings

    monkeypatch.setattr(settings, "telegram_allow_all_chats", False)
    monkeypatch.setattr(settings, "telegram_allowed_chat_ids", ["1"])
    resp = await async_client.post(
        "/v1/telegram/webhook",
        json={
            "update_id": 2,
            "message": {"text": "hi", "message_id": 2, "chat": {"id": 2}},
        },
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_telegram_callback_invalid_run_id(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod

    async def answer(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)
    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": "approve:not-a-uuid:ideation",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["error"] == "invalid_run"


@pytest.mark.anyio
async def test_telegram_callback_unknown_gate(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod

    async def answer(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)
    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": f"approve:{uuid4()}:unknown",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["error"] == "unknown_gate"


@pytest.mark.anyio
async def test_telegram_callback_unknown_action(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod

    async def answer(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)
    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": f"noop:{uuid4()}:ideation",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["error"] == "unknown_action"


@pytest.mark.anyio
async def test_telegram_callback_enqueues_db_approve(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod
    from myloware.config import settings

    run_id = uuid4()
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSessionCM())
    )

    class FakeJobRepo:
        async def enqueue_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr("myloware.storage.repositories.JobRepository", lambda _s: FakeJobRepo())

    async def answer(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)

    async def send_message(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "TelegramNotifier", lambda: SimpleNamespace(send_message=send_message))

    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": f"approve:{run_id}:ideation",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.anyio
async def test_telegram_callback_enqueues_db_reject(async_client, monkeypatch) -> None:
    from myloware.api.routes import telegram as mod
    from myloware.config import settings

    run_id = uuid4()
    monkeypatch.setattr(settings, "workflow_dispatcher", "db")
    monkeypatch.setattr(settings, "disable_background_workflows", False)

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.storage.database.get_async_session_factory", lambda: (lambda: FakeSessionCM())
    )

    class FakeJobRepo:
        async def enqueue_async(self, *_a, **_k):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr("myloware.storage.repositories.JobRepository", lambda _s: FakeJobRepo())

    async def answer(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "_answer_callback", answer)

    async def send_message(*_a, **_k):
        return None

    monkeypatch.setattr(mod, "TelegramNotifier", lambda: SimpleNamespace(send_message=send_message))

    resp = await async_client.post(
        "/v1/telegram/callback",
        json={
            "callback_query": {
                "id": "cb",
                "data": f"reject:{run_id}:publish",
                "message": {"chat": {"id": 1}},
            }
        },
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
