"""Workflow state management and result types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class WorkflowResult:
    """Result of a workflow execution or step.

    Uses string types for JSON serialization compatibility.
    """

    run_id: str
    status: str
    artifacts: Dict[str, Any] = field(default_factory=dict)
    current_step: Optional[str] = None
    error: Optional[str] = None

    @property
    def is_success(self) -> bool:
        """Check if workflow completed successfully."""
        return self.status == "completed"

    @property
    def is_failed(self) -> bool:
        """Check if workflow failed."""
        return self.status == "failed"

    @property
    def is_awaiting_approval(self) -> bool:
        """Check if workflow is waiting for HITL approval."""
        return "awaiting" in self.status.lower()

    @classmethod
    def success(
        cls,
        run_id: str,
        status: str,
        artifacts: Dict[str, Any],
        current_step: str,
    ) -> "WorkflowResult":
        """Create a successful result."""
        return cls(
            run_id=run_id,
            status=status,
            artifacts=artifacts,
            current_step=current_step,
        )

    @classmethod
    def failure(cls, run_id: str, error: str) -> "WorkflowResult":
        """Create a failed result."""
        return cls(
            run_id=run_id,
            status="failed",
            error=error,
        )
