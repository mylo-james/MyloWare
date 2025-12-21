"""Async DB/session dependencies (for async handlers)."""

from typing import AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from myloware.storage.database import get_async_session_factory
from myloware.storage.repositories import ArtifactRepository, FeedbackRepository, RunRepository


async def get_async_db_session() -> AsyncGenerator[AsyncSession, None]:
    SessionLocal = get_async_session_factory()
    session = SessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def get_async_run_repo(
    session: AsyncSession = Depends(get_async_db_session),
) -> RunRepository:
    return RunRepository(session)


async def get_async_artifact_repo(
    session: AsyncSession = Depends(get_async_db_session),
) -> ArtifactRepository:
    return ArtifactRepository(session)


async def get_async_feedback_repo(
    session: AsyncSession = Depends(get_async_db_session),
) -> FeedbackRepository:
    return FeedbackRepository(session)
