from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from myloware.api.dependencies import get_chat_session_repo, get_feedback_repo, verify_api_key
from myloware.config import settings
from myloware.storage.repositories import ChatSessionRepository, FeedbackRepository


def test_dependency_builds_chat_session_repo() -> None:
    session = MagicMock()
    repo = get_chat_session_repo(session=session)  # type: ignore[arg-type]
    assert isinstance(repo, ChatSessionRepository)
    assert repo.session is session


def test_dependency_builds_feedback_repo() -> None:
    session = MagicMock()
    repo = get_feedback_repo(session=session)  # type: ignore[arg-type]
    assert isinstance(repo, FeedbackRepository)
    assert repo.session is session


@pytest.mark.anyio
async def test_verify_api_key_rejects_invalid_key() -> None:
    with pytest.raises(HTTPException) as excinfo:
        await verify_api_key(api_key=f"not-{settings.api_key}")
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Invalid API key"
