"""Base classes and protocols for workflow steps."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Protocol
from uuid import UUID

from llama_stack_client import LlamaStackClient

from storage.repositories import ArtifactRepository, RunRepository
from workflows.state import WorkflowResult


@dataclass
class StepContext:
    """Context passed to workflow steps."""
    
    run_id: UUID
    client: LlamaStackClient
    run_repo: RunRepository
    artifact_repo: ArtifactRepository
    project: str
    brief: str
    vector_db_id: str | None = None
    user_id: str | None = None
    telegram_chat_id: str | None = None
    artifacts: Dict[str, Any] = field(default_factory=dict)
    
    def get_artifact(self, key: str, default: Any = None) -> Any:
        """Get an artifact from context."""
        return self.artifacts.get(key, default)
    
    def set_artifact(self, key: str, value: Any) -> None:
        """Set an artifact in context."""
        self.artifacts[key] = value


class WorkflowStep(Protocol):
    """Protocol for workflow steps.
    
    Steps must implement:
    - name: Step identifier
    - execute: Main execution method
    """
    
    @property
    def name(self) -> str:
        """Step name identifier."""
        ...
    
    def execute(self, context: StepContext) -> WorkflowResult:
        """Execute the step and return result."""
        ...


class BaseStep(ABC):
    """Abstract base class for workflow steps with common functionality."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Step name identifier."""
        raise NotImplementedError
    
    @abstractmethod
    def execute(self, context: StepContext) -> WorkflowResult:
        """Execute the step and return result."""
        raise NotImplementedError
    
    def _update_run_status(
        self,
        context: StepContext,
        status: str,
        step: str | None = None,
    ) -> None:
        """Update run status in database."""
        context.run_repo.update_status(
            context.run_id,
            status,
            current_step=step or self.name,
        )
    
    def _store_artifact(
        self,
        context: StepContext,
        artifact_type: str,
        content: str,
        metadata: Dict[str, Any] | None = None,
    ) -> None:
        """Store an artifact for this step."""
        context.artifact_repo.create(
            run_id=context.run_id,
            persona=self.name,
            artifact_type=artifact_type,
            content=content,
            metadata=metadata or {},
        )

