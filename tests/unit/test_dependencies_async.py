"""Unit tests for async dependency helpers."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


@pytest.mark.anyio
async def test_get_async_db_session_commits_and_closes(monkeypatch) -> None:
    from myloware.api.dependencies_async import get_async_db_session

    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock(), close=AsyncMock())
    monkeypatch.setattr(
        "myloware.api.dependencies_async.get_async_session_factory", lambda: lambda: session
    )

    agen = get_async_db_session()
    yielded = await agen.__anext__()
    assert yielded is session

    with pytest.raises(StopAsyncIteration):
        await agen.__anext__()

    session.commit.assert_awaited_once()
    session.close.assert_awaited_once()
    session.rollback.assert_not_called()


@pytest.mark.anyio
async def test_get_async_db_session_rolls_back_on_error(monkeypatch) -> None:
    from myloware.api.dependencies_async import get_async_db_session

    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock(), close=AsyncMock())
    monkeypatch.setattr(
        "myloware.api.dependencies_async.get_async_session_factory", lambda: lambda: session
    )

    agen = get_async_db_session()
    _ = await agen.__anext__()

    with pytest.raises(RuntimeError):
        await agen.athrow(RuntimeError("boom"))

    session.rollback.assert_awaited_once()
    session.close.assert_awaited_once()


@pytest.mark.anyio
async def test_get_async_feedback_repo_builds_repo() -> None:
    from myloware.api.dependencies_async import get_async_feedback_repo
    from myloware.storage.repositories import FeedbackRepository

    session = SimpleNamespace()
    repo = await get_async_feedback_repo(session=session)  # type: ignore[arg-type]
    assert isinstance(repo, FeedbackRepository)
    assert repo.session is session
