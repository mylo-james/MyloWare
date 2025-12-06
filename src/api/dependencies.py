"""Common FastAPI dependencies for the MyloWare API."""

from __future__ import annotations

from typing import Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from client import get_client
from storage.database import get_session
from storage.repositories import ArtifactRepository, ChatSessionRepository, RunRepository

__all__ = [
    "get_db_session",
    "get_run_repo",
    "get_artifact_repo",
    "get_chat_session_repo",
    "get_llama_client",
    "get_vector_db_id",
]


def get_db_session() -> Generator[Session, None, None]:
    """Provide a SQLAlchemy session for request scope."""

    with get_session() as session:
        yield session


def get_run_repo(session: Session = Depends(get_db_session)) -> RunRepository:
    """Dependency that returns a RunRepository bound to the session."""

    return RunRepository(session)


def get_artifact_repo(session: Session = Depends(get_db_session)) -> ArtifactRepository:
    """Dependency that returns an ArtifactRepository bound to the session."""

    return ArtifactRepository(session)


def get_chat_session_repo(session: Session = Depends(get_db_session)) -> ChatSessionRepository:
    """Dependency that returns a ChatSessionRepository bound to the session."""

    return ChatSessionRepository(session)


def get_llama_client():
    """Provide a cached Llama Stack client."""

    return get_client()


def get_vector_db_id(request: Request) -> str:
    """Return the registered vector DB identifier from app state."""

    return getattr(request.app.state, "vector_db_id", "project_kb_myloware")
