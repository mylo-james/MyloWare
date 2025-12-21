"""Unit tests for feedback API routes."""

from __future__ import annotations

from uuid import uuid4
from unittest.mock import AsyncMock

import pytest


async def _create_run() -> str:
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.models import RunStatus
    from myloware.storage.repositories import RunRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.create_async(
            workflow_name="motivational", input="x", status=RunStatus.PENDING
        )
        await session.commit()
        return str(run.id)


async def _create_feedback(run_id: str) -> None:
    from myloware.storage.database import get_async_session_factory
    from myloware.storage.repositories import FeedbackRepository

    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = FeedbackRepository(session)
        await repo.create_async(run_id=run_id, rating=5, comment="nice")
        await session.commit()


@pytest.mark.anyio
async def test_create_feedback_success(async_client, api_headers) -> None:
    run_id = await _create_run()

    resp = await async_client.post(
        f"/v1/runs/{run_id}/feedback",
        json={"rating": 5, "comment": "Great job"},
        headers=api_headers,
    )
    assert resp.status_code == 201
    payload = resp.json()
    assert payload["run_id"] == run_id
    assert payload["rating"] == 5
    assert payload["comment"] == "Great job"


@pytest.mark.anyio
async def test_create_feedback_run_not_found(async_client, api_headers) -> None:
    missing = uuid4()
    resp = await async_client.post(
        f"/v1/runs/{missing}/feedback",
        json={"rating": 1, "comment": "nope"},
        headers=api_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Run not found"


@pytest.mark.anyio
async def test_get_run_feedback_success(async_client, api_headers) -> None:
    run_id = await _create_run()
    await _create_feedback(run_id)

    resp = await async_client.get(f"/v1/runs/{run_id}/feedback", headers=api_headers)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] >= 1
    assert any(item["run_id"] == run_id for item in payload["feedback"])


@pytest.mark.anyio
async def test_get_run_feedback_run_not_found(async_client, api_headers) -> None:
    missing = uuid4()
    resp = await async_client.get(f"/v1/runs/{missing}/feedback", headers=api_headers)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Run not found"


@pytest.mark.anyio
async def test_create_feedback_direct_success() -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from myloware.api.routes.feedback import FeedbackRequest, create_feedback

    run_id = uuid4()

    class FakeRunRepo:
        async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
            return SimpleNamespace(id=run_id)

    class FakeFeedbackRepo:
        def __init__(self):
            self.session = SimpleNamespace(commit=AsyncMock())

        async def create_async(self, **_k):  # type: ignore[no-untyped-def]
            return SimpleNamespace(
                id=uuid4(),
                run_id=run_id,
                artifact_id=None,
                rating=5,
                comment="ok",
                created_at=datetime.now(timezone.utc),
            )

    req = FeedbackRequest(rating=5, comment="ok")
    resp = await create_feedback(
        run_id, req, run_repo=FakeRunRepo(), feedback_repo=FakeFeedbackRepo()
    )
    assert resp.run_id == str(run_id)
    assert resp.rating == 5


@pytest.mark.anyio
async def test_get_run_feedback_direct_success_and_not_found() -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from myloware.api.routes.feedback import get_run_feedback

    run_id = uuid4()

    class FakeRunRepo:
        def __init__(self, run_exists: bool):
            self._run_exists = run_exists

        async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
            return SimpleNamespace(id=run_id) if self._run_exists else None

    class FakeFeedbackRepo:
        async def get_by_run_id_async(self, _run_id):  # type: ignore[no-untyped-def]
            return [
                SimpleNamespace(
                    id=uuid4(),
                    run_id=run_id,
                    artifact_id=None,
                    rating=5,
                    comment="nice",
                    created_at=datetime.now(timezone.utc),
                )
            ]

    resp = await get_run_feedback(
        run_id,
        run_repo=FakeRunRepo(run_exists=True),
        feedback_repo=FakeFeedbackRepo(),
    )
    assert resp.count == 1

    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        await get_run_feedback(
            run_id,
            run_repo=FakeRunRepo(run_exists=False),
            feedback_repo=FakeFeedbackRepo(),
        )
