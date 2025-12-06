"""SQLAlchemy database models for MyloWare."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
import uuid
from typing import Any, Dict

from sqlalchemy import Column, DateTime, String, Text, JSON, ForeignKey, TypeDecorator
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import declarative_base, relationship


def _utc_now() -> datetime:
    """Return current UTC time (Python 3.12+ compatible)."""
    return datetime.now(timezone.utc)


class GUID(TypeDecorator):
    """Platform-independent GUID type.
    
    Uses PostgreSQL's UUID type when available, otherwise stores as String(36).
    This enables unit tests with SQLite while using native UUIDs in production PostgreSQL.
    """
    impl = String(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        else:
            return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == 'postgresql':
            return value if isinstance(value, uuid.UUID) else uuid.UUID(value)
        else:
            return str(value) if isinstance(value, uuid.UUID) else value

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(value)


Base = declarative_base()

__all__ = ["Base", "Run", "RunStatus", "Artifact", "ArtifactType", "GUID", "ChatSession"]


class RunStatus(str, Enum):
    """Status of a workflow run."""

    PENDING = "pending"
    RUNNING = "running"
    AWAITING_IDEATION_APPROVAL = "awaiting_ideation_approval"
    AWAITING_VIDEO_GENERATION = "awaiting_video_generation"  # Waiting for KIE.ai webhooks
    AWAITING_RENDER = "awaiting_render"  # Waiting for Remotion webhook
    AWAITING_PUBLISH_APPROVAL = "awaiting_publish_approval"
    COMPLETED = "completed"
    FAILED = "failed"


class Run(Base):
    """Workflow run model."""

    __tablename__ = "runs"

    id = Column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    workflow_name = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False, default=RunStatus.PENDING.value)
    current_step = Column(String(64), nullable=True)
    user_id = Column(String(128), nullable=True, index=True)
    telegram_chat_id = Column(String(64), nullable=True, index=True)
    input = Column(Text, nullable=False)
    artifacts = Column(JSON, default=dict)
    error = Column(Text, nullable=True)
    llama_stack_trace_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=_utc_now)
    updated_at = Column(DateTime, default=_utc_now, onupdate=_utc_now)
    artifacts_rel = relationship("Artifact", back_populates="run")

    # Backwards compatibility: allow setting artifacts_dict too
    @property
    def artifacts_dict(self) -> Dict[str, Any]:
        return self.artifacts or {}
    
    @artifacts_dict.setter
    def artifacts_dict(self, value: Dict[str, Any]):
        self.artifacts = value

    def to_dict(self) -> Dict[str, Any]:
        """Convert run to dictionary."""
        return {
            "id": str(self.id),
            "workflow_name": self.workflow_name,
            "status": self.status,
            "current_step": self.current_step,
            "user_id": self.user_id,
            "telegram_chat_id": self.telegram_chat_id,
            "input": self.input,
            "artifacts": self.artifacts,
            "error": self.error,
            "llama_stack_trace_id": self.llama_stack_trace_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Run id={self.id} workflow={self.workflow_name} status={self.status}>"


class ArtifactType(str, Enum):
    """Type of workflow artifact."""

    IDEAS = "ideas"  # Markdown ideation for human review
    IDEAS_STRUCTURED = "ideas_structured"  # JSON structured ideation for automation
    SCRIPT = "script"
    VIDEO_CLIP = "video_clip"  # Individual clip from KIE.ai
    CLIP_MANIFEST = "clip_manifest"  # Task IDs submitted to KIE.ai
    RENDERED_VIDEO = "rendered_video"  # Final video from Remotion
    PUBLISHED_URL = "published_url"
    ERROR = "error"
    REJECTION = "rejection"


class Artifact(Base):
    """Workflow artifact model."""

    __tablename__ = "artifacts"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    run_id = Column(GUID(), ForeignKey("runs.id"), nullable=False)
    persona = Column(String(32), nullable=False)
    artifact_type = Column(String(64), nullable=False)
    content = Column(Text, nullable=True)
    uri = Column(String(512), nullable=True)
    artifact_metadata = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime, default=_utc_now)

    run = relationship("Run", back_populates="artifacts_rel")

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Artifact id={self.id} run={self.run_id} type={self.artifact_type}>"


class ChatSession(Base):
    """Chat session model for multi-worker session persistence.
    
    Stores Llama Stack session IDs per user for the supervisor chat endpoint,
    enabling session continuity across multiple API workers.
    """

    __tablename__ = "chat_sessions"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(128), nullable=False, unique=True, index=True)
    session_id = Column(String(128), nullable=False)
    created_at = Column(DateTime, default=_utc_now)
    updated_at = Column(DateTime, default=_utc_now, onupdate=_utc_now)

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<ChatSession user={self.user_id} session={self.session_id}>"
