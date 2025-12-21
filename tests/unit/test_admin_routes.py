"""Unit tests for admin endpoints."""

from __future__ import annotations

from uuid import UUID, uuid4
from unittest.mock import AsyncMock

import pytest

from myloware.storage.models import RunStatus


async def _create_run() -> UUID:
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import RunRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.create_async(workflow_name="aismr", input="x", status=RunStatus.PENDING)
        await session.commit()
        return run.id


async def _create_dead_letter(run_id: UUID, *, resolved: bool = False) -> UUID:
    from datetime import datetime, timezone

    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import DeadLetterRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = DeadLetterRepository(session)
        dl = await repo.create_async(source="sora", run_id=run_id, payload={"x": 1})
        if resolved:
            dl.resolved_at = datetime.now(timezone.utc)
        await session.commit()
        return dl.id


@pytest.mark.anyio
async def test_admin_dlq_list_and_get(async_client, api_headers) -> None:
    run_id = await _create_run()
    dl_id = await _create_dead_letter(run_id)

    resp = await async_client.get("/admin/dlq", headers=api_headers)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] >= 1
    assert any(item["id"] == str(dl_id) for item in payload["dead_letters"])

    resp2 = await async_client.get(f"/admin/dlq/{dl_id}", headers=api_headers)
    assert resp2.status_code == 200
    assert resp2.json()["id"] == str(dl_id)


@pytest.mark.anyio
async def test_admin_dlq_list_includes_resolved_when_requested(async_client, api_headers) -> None:
    run_id = await _create_run()
    await _create_dead_letter(run_id, resolved=True)

    resp = await async_client.get("/admin/dlq?unresolved_only=false", headers=api_headers)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] >= 1


@pytest.mark.anyio
async def test_admin_dlq_list_filters_by_source(async_client, api_headers) -> None:
    run_id = await _create_run()
    await _create_dead_letter(run_id, resolved=False)

    resp = await async_client.get(
        "/admin/dlq?unresolved_only=false&source=sora", headers=api_headers
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert all(item["source"] == "sora" for item in payload["dead_letters"])


@pytest.mark.anyio
async def test_admin_dlq_list_handles_exception(async_client, api_headers, monkeypatch) -> None:
    async def boom(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("db")

    monkeypatch.setattr(
        "myloware.storage.repositories.DeadLetterRepository.get_unresolved_async",
        boom,
    )
    resp = await async_client.get("/admin/dlq", headers=api_headers)
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_admin_dlq_get_not_found(async_client, api_headers) -> None:
    resp = await async_client.get(f"/admin/dlq/{uuid4()}", headers=api_headers)
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_admin_dlq_get_handles_exception(async_client, api_headers, monkeypatch) -> None:
    async def boom(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("db")

    monkeypatch.setattr("myloware.storage.repositories.DeadLetterRepository.get_async", boom)
    resp = await async_client.get(f"/admin/dlq/{uuid4()}", headers=api_headers)
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_admin_dlq_resolve(async_client, api_headers) -> None:
    run_id = await _create_run()
    dl_id = await _create_dead_letter(run_id)

    resp = await async_client.post(f"/admin/dlq/{dl_id}/resolve", headers=api_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved"

    resp2 = await async_client.post(f"/admin/dlq/{dl_id}/resolve", headers=api_headers)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "already_resolved"


@pytest.mark.anyio
async def test_admin_dlq_resolve_not_found(async_client, api_headers) -> None:
    resp = await async_client.post(f"/admin/dlq/{uuid4()}/resolve", headers=api_headers)
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_admin_dlq_resolve_handles_exception(async_client, api_headers, monkeypatch) -> None:
    run_id = await _create_run()
    dl_id = await _create_dead_letter(run_id)

    async def boom(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("db")

    monkeypatch.setattr(
        "myloware.storage.repositories.DeadLetterRepository.mark_resolved_async",
        boom,
    )
    resp = await async_client.post(f"/admin/dlq/{dl_id}/resolve", headers=api_headers)
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_admin_dlq_replay_marks_resolved(async_client, api_headers, monkeypatch) -> None:
    run_id = await _create_run()
    dl_id = await _create_dead_letter(run_id)

    async def fake_replay(_dl):
        return {"status": "replayed"}

    monkeypatch.setattr("myloware.api.routes.admin._replay_dead_letter", fake_replay)

    resp = await async_client.post(f"/admin/dlq/{dl_id}/replay", headers=api_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "replayed"


@pytest.mark.anyio
async def test_admin_dlq_replay_rejects_resolved(async_client, api_headers) -> None:
    run_id = await _create_run()
    dl_id = await _create_dead_letter(run_id, resolved=True)

    resp = await async_client.post(f"/admin/dlq/{dl_id}/replay", headers=api_headers)
    assert resp.status_code == 400
    assert "already resolved" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_admin_dlq_replay_not_found(async_client, api_headers) -> None:
    resp = await async_client.post(f"/admin/dlq/{uuid4()}/replay", headers=api_headers)
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_admin_dlq_replay_handles_exception(async_client, api_headers, monkeypatch) -> None:
    run_id = await _create_run()
    dl_id = await _create_dead_letter(run_id)

    async def boom(_dl):  # type: ignore[no-untyped-def]
        raise RuntimeError("explode")

    monkeypatch.setattr("myloware.api.routes.admin._replay_dead_letter", boom)

    resp = await async_client.post(f"/admin/dlq/{dl_id}/replay", headers=api_headers)
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_admin_dlq_replay_handles_value_error(async_client, api_headers, monkeypatch) -> None:
    run_id = await _create_run()
    dl_id = await _create_dead_letter(run_id)

    async def fake_replay(_dl):
        raise ValueError("bad payload")

    monkeypatch.setattr("myloware.workflows.dlq_replay.replay_dead_letter", fake_replay)

    resp = await async_client.post(f"/admin/dlq/{dl_id}/replay", headers=api_headers)
    assert resp.status_code == 400
    assert "bad payload" in resp.json()["detail"]


@pytest.mark.anyio
async def test_admin_reload_kb(monkeypatch, async_client, api_headers) -> None:
    from myloware.config import settings

    monkeypatch.setattr(settings, "project_id", "proj")

    monkeypatch.setattr("myloware.api.routes.admin.get_sync_client", lambda: object())
    monkeypatch.setattr(
        "myloware.api.routes.admin.load_documents_with_manifest",
        lambda *_a, **_k: ([{"id": "d1"}], {"hash": "h"}),
    )
    monkeypatch.setattr(
        "myloware.api.routes.admin.setup_project_knowledge",
        lambda *_a, **_k: "project_kb_proj",
    )

    resp = await async_client.post("/admin/kb/reload", headers=api_headers)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "reloaded"
    assert payload["vector_db_id"] == "project_kb_proj"


@pytest.mark.anyio
async def test_admin_dlq_list_unresolved_false_executes_query(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from myloware.api.routes.admin import list_dead_letters

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=None,
    )

    class FakeResult:
        def scalars(self):  # type: ignore[no-untyped-def]
            return self

        def all(self):  # type: ignore[no-untyped-def]
            return [dead_letter]

    class FakeSession:
        async def execute(self, _query):  # type: ignore[no-untyped-def]
            return FakeResult()

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr(
        "myloware.storage.repositories.DeadLetterRepository.get_unresolved_async",
        AsyncMock(side_effect=AssertionError("should not call unresolved path")),
    )

    resp = await list_dead_letters(request=SimpleNamespace(), source="sora", unresolved_only=False)
    assert resp.count == 1


@pytest.mark.anyio
async def test_admin_dlq_resolve_direct_marks_resolved(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from myloware.api.routes.admin import resolve_dead_letter

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=None,
    )

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return dead_letter

        async def mark_resolved_async(self, _dl_id):  # type: ignore[no-untyped-def]
            dead_letter.resolved_at = datetime.now(timezone.utc)

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    resp = await resolve_dead_letter(request=SimpleNamespace(), dead_letter_id=str(dead_letter.id))
    assert resp["status"] == "resolved"


@pytest.mark.anyio
async def test_admin_get_dead_letter_direct_not_found(monkeypatch) -> None:
    from types import SimpleNamespace

    from fastapi import HTTPException
    from myloware.api.routes.admin import get_dead_letter

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    with pytest.raises(HTTPException):
        await get_dead_letter(request=SimpleNamespace(), dead_letter_id=str(uuid4()))


@pytest.mark.anyio
async def test_admin_get_dead_letter_direct_success(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from myloware.api.routes.admin import get_dead_letter

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=None,
    )

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return dead_letter

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    resp = await get_dead_letter(request=SimpleNamespace(), dead_letter_id=str(dead_letter.id))
    assert resp.id == str(dead_letter.id)


@pytest.mark.anyio
async def test_admin_replay_dead_letter_direct_success(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from myloware.api.routes.admin import replay_dead_letter

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=None,
    )

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return dead_letter

        async def mark_resolved_async(self, _dl_id):  # type: ignore[no-untyped-def]
            dead_letter.resolved_at = datetime.now(timezone.utc)

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    async def fake_replay(_dl):  # type: ignore[no-untyped-def]
        return {"status": "replayed"}

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)
    monkeypatch.setattr("myloware.api.routes.admin._replay_dead_letter", fake_replay)

    resp = await replay_dead_letter(request=SimpleNamespace(), dead_letter_id=str(dead_letter.id))
    assert resp["status"] == "replayed"


@pytest.mark.anyio
async def test_admin_replay_dead_letter_direct_not_found(monkeypatch) -> None:
    from types import SimpleNamespace

    from fastapi import HTTPException
    from myloware.api.routes.admin import replay_dead_letter

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    with pytest.raises(HTTPException):
        await replay_dead_letter(request=SimpleNamespace(), dead_letter_id=str(uuid4()))


@pytest.mark.anyio
async def test_admin_replay_dead_letter_direct_already_resolved(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from fastapi import HTTPException
    from myloware.api.routes.admin import replay_dead_letter

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=datetime.now(timezone.utc),
    )

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return dead_letter

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    with pytest.raises(HTTPException):
        await replay_dead_letter(request=SimpleNamespace(), dead_letter_id=str(dead_letter.id))


@pytest.mark.anyio
async def test_admin_replay_dead_letter_direct_handles_exception(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from fastapi import HTTPException
    from myloware.api.routes.admin import replay_dead_letter

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=None,
    )

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return dead_letter

        async def mark_resolved_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    async def boom(_dl):  # type: ignore[no-untyped-def]
        raise RuntimeError("explode")

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)
    monkeypatch.setattr("myloware.api.routes.admin._replay_dead_letter", boom)

    with pytest.raises(HTTPException):
        await replay_dead_letter(request=SimpleNamespace(), dead_letter_id=str(dead_letter.id))


@pytest.mark.anyio
async def test_admin_resolve_dead_letter_direct_already_resolved(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from myloware.api.routes.admin import resolve_dead_letter

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=datetime.now(timezone.utc),
    )

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return dead_letter

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    resp = await resolve_dead_letter(request=SimpleNamespace(), dead_letter_id=str(dead_letter.id))
    assert resp["status"] == "already_resolved"


@pytest.mark.anyio
async def test_admin_resolve_dead_letter_direct_handles_exception(monkeypatch) -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from fastapi import HTTPException
    from myloware.api.routes.admin import resolve_dead_letter

    dead_letter = SimpleNamespace(
        id=uuid4(),
        source="sora",
        run_id=uuid4(),
        payload={"x": 1},
        error=None,
        attempts=1,
        created_at=datetime.now(timezone.utc),
        last_attempt_at=None,
        resolved_at=None,
    )

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return dead_letter

        async def mark_resolved_async(self, _dl_id):  # type: ignore[no-untyped-def]
            raise RuntimeError("boom")

    class FakeSession:
        async def commit(self):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    with pytest.raises(HTTPException):
        await resolve_dead_letter(request=SimpleNamespace(), dead_letter_id=str(dead_letter.id))


@pytest.mark.anyio
async def test_admin_resolve_dead_letter_direct_not_found(monkeypatch) -> None:
    from types import SimpleNamespace

    from fastapi import HTTPException
    from myloware.api.routes.admin import resolve_dead_letter

    class FakeRepo:
        def __init__(self, _session):  # type: ignore[no-untyped-def]
            return None

        async def get_async(self, _dl_id):  # type: ignore[no-untyped-def]
            return None

    class FakeSessionCM:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return object()

        async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
            return None

    monkeypatch.setattr(
        "myloware.api.routes.admin.get_async_session_factory",
        lambda: (lambda: FakeSessionCM()),
    )
    monkeypatch.setattr("myloware.api.routes.admin.DeadLetterRepository", FakeRepo)

    with pytest.raises(HTTPException):
        await resolve_dead_letter(request=SimpleNamespace(), dead_letter_id=str(uuid4()))
