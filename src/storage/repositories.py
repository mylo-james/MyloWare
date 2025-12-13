"""Data access repositories."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from observability.logging import get_logger
from storage.models import (
    Artifact,
    ArtifactType,
    AuditLog,
    ChatSession,
    DeadLetter,
    Feedback,
    Run,
    RunStatus,
)

logger = get_logger(__name__)

__all__ = [
    "RunRepository",
    "ArtifactRepository",
    "ChatSessionRepository",
    "AuditLogRepository",
    "FeedbackRepository",
    "DeadLetterRepository",
]


class RunRepository:
    """Repository for Run CRUD operations."""

    def __init__(self, session: Session | AsyncSession):
        self.session = session

    def create(
        self,
        workflow_name: str,
        input: str,
        status: RunStatus = RunStatus.PENDING,
        current_step: str | None = None,
        user_id: str | None = None,
        telegram_chat_id: str | None = None,
    ) -> Run:
        # Support both sync and async sessions; prefer async path for AsyncSession callers
        if isinstance(self.session, AsyncSession):
            raise TypeError("Use create_async() with AsyncSession")

        if telegram_chat_id is not None:
            try:
                telegram_chat_id = int(telegram_chat_id)
            except (TypeError, ValueError):
                telegram_chat_id = None

        run = Run(
            workflow_name=workflow_name,
            input=input,
            status=status.value,
            current_step=current_step,
            user_id=user_id,
            telegram_chat_id=telegram_chat_id,
        )
        self.session.add(run)
        self.session.flush()
        logger.info("Created run %s for workflow %s", run.id, workflow_name)
        return run

    async def create_async(
        self,
        workflow_name: str,
        brief: str,
        user_id: str | None = None,
        telegram_chat_id: str | None = None,
    ) -> Run:
        """Async convenience wrapper."""
        # Normalize telegram_chat_id to int to match DB column (bigint)
        if telegram_chat_id is not None:
            try:
                telegram_chat_id = int(telegram_chat_id)
            except (TypeError, ValueError):
                telegram_chat_id = None

        run = Run(
            workflow_name=workflow_name,
            input=brief,
            status=RunStatus.PENDING.value,
            user_id=user_id,
            telegram_chat_id=telegram_chat_id,
        )
        self.session.add(run)
        await self.session.flush()
        logger.info("Created run %s for workflow %s (async)", run.id, workflow_name)
        return run

    def get(self, run_id: UUID) -> Optional[Run]:
        return self.session.query(Run).filter(Run.id == run_id).first()

    async def get_async(self, run_id: UUID) -> Optional[Run]:
        result = await self.session.execute(select(Run).where(Run.id == run_id))
        return result.scalar_one_or_none()

    def get_for_update(self, run_id: UUID) -> Optional[Run]:
        """Get a run with a FOR UPDATE lock to prevent race conditions.

        Use this when you need to read-modify-write a run atomically,
        e.g., in webhook handlers where multiple callbacks may arrive concurrently.
        """
        stmt = select(Run).where(Run.id == run_id).with_for_update()
        return self.session.execute(stmt).scalar_one_or_none()

    async def get_for_update_async(self, run_id: UUID) -> Optional[Run]:
        stmt = select(Run).where(Run.id == run_id).with_for_update()
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    def get_by_id_str(self, run_id: str) -> Optional[Run]:
        return self.get(UUID(run_id))

    def update(self, run_id: UUID, **kwargs: Any) -> Optional[Run]:
        run = self.get(run_id)
        if run is None:
            return None

        for key, value in kwargs.items():
            if hasattr(run, key):
                if key == "status":
                    value = self._normalize_status(value)
                setattr(run, key, value)

        self.session.flush()
        logger.info("Updated run %s: %s", run_id, list(kwargs.keys()))
        return run

    async def update_async(self, run_id: UUID, **kwargs: Any) -> Optional[Run]:
        run = await self.get_async(run_id)
        if run is None:
            return None

        for key, value in kwargs.items():
            if hasattr(run, key):
                if key == "status":
                    value = self._normalize_status(value)
                setattr(run, key, value)

        await self.session.flush()
        logger.info("Updated run %s async: %s", run_id, list(kwargs.keys()))
        return run

    def update_status(self, run_id: UUID, status: RunStatus) -> Optional[Run]:
        return self.update(run_id, status=status.value)

    async def update_status_async(self, run_id: UUID, status: RunStatus) -> Optional[Run]:
        return await self.update_async(run_id, status=status.value)

    async def count_runs_since_async(self, dt: datetime) -> int:
        # Normalize to naive datetime because created_at is stored without tz
        dt_naive = dt.replace(tzinfo=None) if dt.tzinfo else dt
        stmt = select(func.count()).select_from(Run).where(Run.created_at >= dt_naive)
        result = await self.session.execute(stmt)
        return int(result.scalar_one() or 0)

    @staticmethod
    def _normalize_status(value: RunStatus | str) -> str:
        """Validate and normalize run status to string value."""
        if isinstance(value, RunStatus):
            return value.value
        if isinstance(value, str):
            try:
                return RunStatus(value).value
            except ValueError:
                # allow already-normalized strings if they match values
                if value in {status.value for status in RunStatus}:
                    return value
        raise ValueError(f"Invalid run status: {value}")

    def update_step(self, run_id: UUID, step: str) -> Optional[Run]:
        return self.update(run_id, current_step=step)

    def add_artifact(self, run_id: UUID, key: str, value: any) -> Optional[Run]:
        run = self.get(run_id)
        if run is None:
            return None

        artifacts = run.artifacts.copy() if run.artifacts else {}
        artifacts[key] = value
        run.artifacts = artifacts
        # Explicitly mark JSON column as modified (SQLAlchemy may not detect mutations)
        flag_modified(run, "artifacts")
        self.session.flush()
        logger.info("Added artifact '%s' to run %s", key, run_id)
        return run

    async def add_artifact_async(self, run_id: UUID, key: str, value: any) -> Optional[Run]:
        run = await self.get_async(run_id)
        if run is None:
            return None

        artifacts = run.artifacts.copy() if run.artifacts else {}
        artifacts[key] = value
        run.artifacts = artifacts
        flag_modified(run, "artifacts")
        await self.session.flush()
        logger.info("Added artifact '%s' to run %s (async)", key, run_id)
        return run

    def list(
        self,
        limit: int = 10,
        offset: int = 0,
        status: Optional[RunStatus] = None,
        user_id: str | None = None,
    ) -> List[Run]:
        query = self.session.query(Run)
        if status:
            query = query.filter(Run.status == status.value)
        if user_id:
            query = query.filter(Run.user_id == user_id)
        return query.order_by(Run.created_at.desc()).offset(offset).limit(limit).all()

    def find_by_status_and_age(
        self,
        status: str,
        older_than: datetime,
    ) -> List[Run]:
        """Find runs with a specific status that haven't been updated since cutoff.

        Args:
            status: Run status value to filter by
            older_than: Cutoff datetime - returns runs updated before this time

        Returns:
            List of Run objects matching the criteria
        """
        return (
            self.session.query(Run)
            .filter(Run.status == status)
            .filter(Run.updated_at < older_than)
            .order_by(Run.updated_at.asc())
            .all()
        )


class ArtifactRepository:
    """Repository for Artifact CRUD operations."""

    def __init__(self, session: Session | AsyncSession):
        self.session = session

    def create(
        self,
        run_id: UUID,
        persona: str,
        artifact_type: ArtifactType,
        content: Optional[str] = None,
        uri: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
    ) -> Artifact:
        """Create a new artifact."""

        meta = metadata.copy() if metadata else {}
        if trace_id:
            meta.setdefault("trace_id", trace_id)

        artifact = Artifact(
            run_id=run_id,
            persona=persona,
            artifact_type=artifact_type.value,
            content=content,
            uri=uri,
            artifact_metadata=meta,
        )
        self.session.add(artifact)
        self.session.flush()
        logger.info(
            "Created artifact type=%s persona=%s run=%s", artifact_type.value, persona, run_id
        )
        return artifact

    async def create_async(
        self,
        run_id: UUID,
        persona: str,
        artifact_type: ArtifactType,
        content: Optional[str] = None,
        uri: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
    ) -> Artifact:
        meta = metadata.copy() if metadata else {}
        if trace_id:
            meta.setdefault("trace_id", trace_id)

        artifact = Artifact(
            run_id=run_id,
            persona=persona,
            artifact_type=artifact_type.value,
            content=content,
            uri=uri,
            artifact_metadata=meta,
        )
        self.session.add(artifact)
        await self.session.flush()
        logger.info(
            "Created artifact type=%s persona=%s run=%s (async)",
            artifact_type.value,
            persona,
            run_id,
        )
        return artifact

    def get_by_run(self, run_id: UUID) -> List[Artifact]:
        """Get all artifacts for a run ordered by creation time."""
        return (
            self.session.query(Artifact)
            .filter(Artifact.run_id == run_id)
            .order_by(Artifact.created_at)
            .all()
        )

    async def get_by_run_async(self, run_id: UUID) -> List[Artifact]:
        """Async: Get all artifacts for a run ordered by creation time."""
        result = await self.session.execute(
            select(Artifact).where(Artifact.run_id == run_id).order_by(Artifact.created_at)
        )
        return result.scalars().all()

    def get_by_type(self, run_id: UUID, artifact_type: ArtifactType) -> Optional[Artifact]:
        """Get a single artifact by type for a run."""
        return (
            self.session.query(Artifact)
            .filter(Artifact.run_id == run_id)
            .filter(Artifact.artifact_type == artifact_type.value)
            .first()
        )

    def get_latest_artifact_by_type(
        self, run_id: UUID, artifact_type: ArtifactType
    ) -> Optional[Artifact]:
        """Get the most recent artifact of a specific type for a run."""
        return (
            self.session.query(Artifact)
            .filter(Artifact.run_id == run_id)
            .filter(Artifact.artifact_type == artifact_type.value)
            .order_by(Artifact.created_at.desc())
            .first()
        )

    def find_cached_videos(
        self,
        topic: str,
        signs: Optional[List[str]] = None,
        limit: int = 12,
    ) -> List[Artifact]:
        """Find cached video clips by topic and optional zodiac signs.

        Searches across ALL runs for VIDEO_CLIP artifacts with matching metadata.
        When signs are provided, returns ONE clip per sign in the order specified.

        Args:
            topic: The topic to match (e.g., "puppies")
            signs: Optional list of zodiac signs - results will be ordered by this list
            limit: Maximum number of results to return

        Returns:
            List of matching Artifact objects with video URLs, ordered by signs if provided
        """
        # Get all video clips with URIs first, then filter in Python
        # This avoids JSON query compatibility issues across PostgreSQL/SQLite
        all_clips = (
            self.session.query(Artifact)
            .filter(Artifact.artifact_type == ArtifactType.VIDEO_CLIP.value)
            .filter(Artifact.uri.isnot(None))
            .order_by(Artifact.created_at.desc())
            .all()
        )

        # Build a dict of sign -> clip (most recent first, so first match wins)
        sign_to_clip: Dict[str, Artifact] = {}
        topic_clips: List[Artifact] = []

        for clip in all_clips:
            meta = clip.artifact_metadata or {}
            clip_topic = meta.get("topic", "")
            clip_sign = meta.get("sign", "")

            if clip_topic.lower() == topic.lower():
                if signs is None:
                    # No sign filter - just collect all
                    topic_clips.append(clip)
                    if len(topic_clips) >= limit:
                        break
                elif clip_sign and clip_sign in signs and clip_sign not in sign_to_clip:
                    # Sign filter - store first (most recent) clip per sign
                    sign_to_clip[clip_sign] = clip

        if signs is None:
            return topic_clips

        # Return clips in the order of signs list
        results = []
        for sign in signs:
            if sign in sign_to_clip:
                results.append(sign_to_clip[sign])
            if len(results) >= limit:
                break

        return results

    def count_cached_videos_by_topic(self, topic: str) -> int:
        """Count how many cached videos exist for a topic."""
        all_clips = (
            self.session.query(Artifact)
            .filter(Artifact.artifact_type == ArtifactType.VIDEO_CLIP.value)
            .filter(Artifact.uri.isnot(None))
            .all()
        )

        count = 0
        for clip in all_clips:
            meta = clip.artifact_metadata or {}
            if meta.get("topic", "").lower() == topic.lower():
                count += 1
        return count


class ChatSessionRepository:
    """Repository for ChatSession CRUD operations.

    Provides database-backed session storage for multi-worker deployments,
    replacing the in-memory session cache.
    """

    def __init__(self, session: Session):
        self.session = session

    def get_session(self, user_id: str) -> Optional[str]:
        """Get Llama Stack session ID for a user."""
        chat_session = (
            self.session.query(ChatSession).filter(ChatSession.user_id == user_id).first()
        )
        return chat_session.session_id if chat_session else None

    def create_or_update_session(self, user_id: str, session_id: str) -> ChatSession:
        """Create or update a chat session for a user."""
        chat_session = (
            self.session.query(ChatSession).filter(ChatSession.user_id == user_id).first()
        )
        if chat_session:
            chat_session.session_id = session_id
            logger.info("Updated chat session for user %s", user_id)
        else:
            chat_session = ChatSession(user_id=user_id, session_id=session_id)
            self.session.add(chat_session)
            logger.info("Created chat session for user %s", user_id)
        self.session.flush()
        return chat_session

    def delete_session(self, user_id: str) -> bool:
        """Delete a chat session for a user."""
        deleted = self.session.query(ChatSession).filter(ChatSession.user_id == user_id).delete()
        self.session.flush()
        return deleted > 0


class AuditLogRepository:
    """Repository for AuditLog CRUD operations.

    Provides audit trail storage for workflow events and gate decisions.
    """

    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        action: str,
        user_id: Optional[str] = None,
        run_id: Optional[UUID] = None,
        duration_ms: Optional[int] = None,
        outcome: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AuditLog:
        """Create an audit log entry."""
        audit_log = AuditLog(
            action=action,
            user_id=user_id,
            run_id=run_id,
            duration_ms=duration_ms,
            outcome=outcome,
            audit_metadata=metadata or {},
        )
        self.session.add(audit_log)
        self.session.flush()
        logger.info(
            "audit_log_created",
            action=action,
            user_id=user_id,
            run_id=str(run_id) if run_id else None,
            outcome=outcome,
        )
        return audit_log

    def get_by_run_id(self, run_id: UUID) -> List[AuditLog]:
        """Get all audit logs for a run ordered by creation time."""
        return (
            self.session.query(AuditLog)
            .filter(AuditLog.run_id == run_id)
            .order_by(AuditLog.created_at)
            .all()
        )

    def get_by_user_id(self, user_id: str, limit: int = 100) -> List[AuditLog]:
        """Get audit logs for a user ordered by creation time (most recent first)."""
        return (
            self.session.query(AuditLog)
            .filter(AuditLog.user_id == user_id)
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
            .all()
        )


class FeedbackRepository:
    """Repository for Feedback CRUD operations.

    Manages human feedback on workflow outputs for evaluation
    and preference learning.
    """

    def __init__(self, session: Session | AsyncSession):
        self.session = session

    def create(
        self,
        run_id: UUID,
        rating: int,
        artifact_id: Optional[UUID] = None,
        comment: Optional[str] = None,
    ) -> Feedback:
        """Create a feedback entry.

        Args:
            run_id: ID of the run being rated
            rating: Rating value (1=down, 5=up)
            artifact_id: Optional specific artifact being rated
            comment: Optional text comment

        Returns:
            Created Feedback instance
        """
        feedback = Feedback(
            run_id=run_id,
            artifact_id=artifact_id,
            rating=rating,
            comment=comment,
        )
        self.session.add(feedback)
        self.session.flush()
        logger.info(
            "feedback_created",
            run_id=str(run_id),
            rating=rating,
        )
        return feedback

    async def create_async(
        self,
        run_id: UUID,
        rating: int,
        artifact_id: Optional[UUID] = None,
        comment: Optional[str] = None,
    ) -> Feedback:
        feedback = Feedback(
            run_id=run_id,
            artifact_id=artifact_id,
            rating=rating,
            comment=comment,
        )
        self.session.add(feedback)
        await self.session.flush()
        logger.info(
            "feedback_created_async",
            run_id=str(run_id),
            rating=rating,
        )
        return feedback

    def get_by_run_id(self, run_id: UUID) -> List[Feedback]:
        """Get all feedback for a run."""
        return (
            self.session.query(Feedback)
            .filter(Feedback.run_id == run_id)
            .order_by(Feedback.created_at.desc())
            .all()
        )

    async def get_by_run_id_async(self, run_id: UUID) -> List[Feedback]:
        """Async: Get all feedback for a run."""
        result = await self.session.execute(
            select(Feedback).where(Feedback.run_id == run_id).order_by(Feedback.created_at.desc())
        )
        return result.scalars().all()

    def get_positive_feedback(self, limit: int = 100) -> List[Feedback]:
        """Get positive feedback entries for eval dataset curation.

        Returns feedback with rating >= 4, ordered by most recent.
        """
        return (
            self.session.query(Feedback)
            .filter(Feedback.rating >= 4)
            .order_by(Feedback.created_at.desc())
            .limit(limit)
            .all()
        )


class DeadLetterRepository:
    """Repository for DeadLetter CRUD operations."""

    def __init__(self, session: Session | AsyncSession):
        self.session = session

    def create(
        self,
        source: str,
        run_id: UUID,
        payload: Dict[str, Any],
        error: str | None = None,
        attempts: int = 0,
    ) -> DeadLetter:
        """Create a dead letter entry.

        Args:
            source: Source of the webhook ("sora", "remotion")
            run_id: ID of the run associated with the webhook
            payload: Original webhook payload
            error: Error message from last attempt
            attempts: Number of retry attempts made

        Returns:
            Created DeadLetter instance
        """
        from datetime import timezone

        dead_letter = DeadLetter(
            source=source,
            run_id=run_id,
            payload=payload,
            error=error,
            attempts=attempts,
            last_attempt_at=datetime.now(timezone.utc),
        )
        self.session.add(dead_letter)
        self.session.flush()
        logger.info(
            "dead_letter_created",
            id=str(dead_letter.id),
            source=source,
            run_id=str(run_id),
            attempts=attempts,
        )
        return dead_letter

    async def create_async(
        self,
        source: str,
        run_id: UUID,
        payload: Dict[str, Any],
        error: str | None = None,
        attempts: int = 0,
    ) -> DeadLetter:
        """Async: Create a dead letter entry."""
        from datetime import timezone

        dead_letter = DeadLetter(
            source=source,
            run_id=run_id,
            payload=payload,
            error=error,
            attempts=attempts,
            last_attempt_at=datetime.now(timezone.utc),
        )
        self.session.add(dead_letter)
        await self.session.flush()
        logger.info(
            "dead_letter_created_async",
            id=str(dead_letter.id),
            source=source,
            run_id=str(run_id),
        )
        return dead_letter

    def get_unresolved(self, source: str | None = None) -> List[DeadLetter]:
        """Get all unresolved dead letters, optionally filtered by source.

        Args:
            source: Optional source filter ("sora", "remotion")

        Returns:
            List of unresolved DeadLetter entries
        """
        query = self.session.query(DeadLetter).filter(DeadLetter.resolved_at.is_(None))
        if source:
            query = query.filter(DeadLetter.source == source)
        return query.order_by(DeadLetter.created_at.desc()).all()

    async def get_unresolved_async(self, source: str | None = None) -> List[DeadLetter]:
        """Async: Get all unresolved dead letters."""
        query = select(DeadLetter).where(DeadLetter.resolved_at.is_(None))
        if source:
            query = query.where(DeadLetter.source == source)
        query = query.order_by(DeadLetter.created_at.desc())
        result = await self.session.execute(query)
        return result.scalars().all()

    def get(self, dead_letter_id: UUID) -> Optional[DeadLetter]:
        """Get a dead letter by ID."""
        return self.session.query(DeadLetter).filter(DeadLetter.id == dead_letter_id).first()

    async def get_async(self, dead_letter_id: UUID) -> Optional[DeadLetter]:
        """Async: Get a dead letter by ID."""
        result = await self.session.execute(
            select(DeadLetter).where(DeadLetter.id == dead_letter_id)
        )
        return result.scalar_one_or_none()

    def mark_resolved(self, dead_letter_id: UUID) -> None:
        """Mark a dead letter as resolved."""
        from datetime import timezone

        dead_letter = self.get(dead_letter_id)
        if dead_letter:
            dead_letter.resolved_at = datetime.now(timezone.utc)
            self.session.flush()
            logger.info("dead_letter_resolved", id=str(dead_letter_id))

    async def mark_resolved_async(self, dead_letter_id: UUID) -> None:
        """Async: Mark a dead letter as resolved."""
        from datetime import timezone

        dead_letter = await self.get_async(dead_letter_id)
        if dead_letter:
            dead_letter.resolved_at = datetime.now(timezone.utc)
            await self.session.flush()
            logger.info("dead_letter_resolved_async", id=str(dead_letter_id))

    def increment_attempts(self, dead_letter_id: UUID) -> None:
        """Increment retry attempts counter."""
        from datetime import timezone

        dead_letter = self.get(dead_letter_id)
        if dead_letter:
            dead_letter.attempts += 1
            dead_letter.last_attempt_at = datetime.now(timezone.utc)
            self.session.flush()

    async def increment_attempts_async(self, dead_letter_id: UUID) -> None:
        """Async: Increment retry attempts counter."""
        from datetime import timezone

        dead_letter = await self.get_async(dead_letter_id)
        if dead_letter:
            dead_letter.attempts += 1
            dead_letter.last_attempt_at = datetime.now(timezone.utc)
            await self.session.flush()
