"""MyloWare workflows module - Multi-agent orchestration.

Architecture:
- orchestrator.py: Thin coordinator (<200 lines)
- state.py: WorkflowResult and state management
- parsers.py: Parsing utilities for workflow data
- helpers.py: Shared utilities (notifications, caching)
- steps/: Individual workflow step implementations
  - ideation.py: Generate ideas from brief
  - production.py: Generate video clips
  - editing.py: Compose final video
  - publishing.py: Publish to platforms
"""

from workflows.orchestrator import (
    run_workflow,
    run_workflow_async,
    create_pending_run,
    continue_after_ideation,
    continue_after_producer,
    continue_after_publish_approval,
)
from workflows.state import WorkflowResult
from workflows.parsers import parse_structured_ideation, extract_topic_from_brief
from workflows.steps import (
    WorkflowStep,
    StepContext,
    IdeationStep,
    ProductionStep,
    EditingStep,
    PublishingStep,
)

__all__ = [
    # Orchestrator functions
    "run_workflow",
    "run_workflow_async",
    "create_pending_run",
    "continue_after_ideation",
    "continue_after_producer",
    "continue_after_publish_approval",
    # Types
    "WorkflowResult",
    "WorkflowStep",
    "StepContext",
    # Step classes
    "IdeationStep",
    "ProductionStep",
    "EditingStep",
    "PublishingStep",
    # Parsers
    "parse_structured_ideation",
    "extract_topic_from_brief",
]
