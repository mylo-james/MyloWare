"""Data access repositories."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from storage.models import Artifact, ArtifactType, ChatSession, Run, RunStatus

logger = logging.getLogger(__name__)

__all__ = ["RunRepository", "ArtifactRepository", "ChatSessionRepository"]


class RunRepository:
    """Repository for Run CRUD operations."""

    def __init__(self, session: Session):
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

    def get(self, run_id: UUID) -> Optional[Run]:
        return self.session.query(Run).filter(Run.id == run_id).first()

    def get_for_update(self, run_id: UUID) -> Optional[Run]:
        """Get a run with a FOR UPDATE lock to prevent race conditions.
        
        Use this when you need to read-modify-write a run atomically,
        e.g., in webhook handlers where multiple callbacks may arrive concurrently.
        """
        stmt = select(Run).where(Run.id == run_id).with_for_update()
        return self.session.execute(stmt).scalar_one_or_none()

    def get_by_id_str(self, run_id: str) -> Optional[Run]:
        return self.get(UUID(run_id))

    def update(self, run_id: UUID, **kwargs) -> Optional[Run]:
        run = self.get(run_id)
        if run is None:
            return None

        for key, value in kwargs.items():
            if hasattr(run, key):
                setattr(run, key, value)

        self.session.flush()
        logger.info("Updated run %s: %s", run_id, list(kwargs.keys()))
        return run

    def update_status(self, run_id: UUID, status: RunStatus) -> Optional[Run]:
        return self.update(run_id, status=status.value)

    def update_step(self, run_id: UUID, step: str) -> Optional[Run]:
        return self.update(run_id, current_step=step)

    def add_artifact(self, run_id: UUID, key: str, value: any) -> Optional[Run]:
        from sqlalchemy.orm.attributes import flag_modified
        
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


class ArtifactRepository:
    """Repository for Artifact CRUD operations."""

    def __init__(self, session: Session):
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

    def get_by_run(self, run_id: UUID) -> List[Artifact]:
        """Get all artifacts for a run ordered by creation time."""
        return (
            self.session.query(Artifact)
            .filter(Artifact.run_id == run_id)
            .order_by(Artifact.created_at)
            .all()
        )

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
            self.session.query(ChatSession)
            .filter(ChatSession.user_id == user_id)
            .first()
        )
        return chat_session.session_id if chat_session else None

    def create_or_update_session(self, user_id: str, session_id: str) -> ChatSession:
        """Create or update a chat session for a user."""
        chat_session = (
            self.session.query(ChatSession)
            .filter(ChatSession.user_id == user_id)
            .first()
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
        deleted = (
            self.session.query(ChatSession)
            .filter(ChatSession.user_id == user_id)
            .delete()
        )
        self.session.flush()
        return deleted > 0
