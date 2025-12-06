"""Ideation step - generates creative ideas from brief."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict
from uuid import UUID

from langfuse import observe
from llama_stack_client import LlamaStackClient

from agents.factory import create_agent
from client import extract_content
from storage.models import ArtifactType, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.helpers import extract_trace_id, notify_telegram
from workflows.parsers import parse_structured_ideation
from workflows.state import WorkflowResult
from workflows.steps.base import BaseStep, StepContext

logger = logging.getLogger(__name__)


class IdeationStep(BaseStep):
    """Generate creative ideas from a brief using the ideator agent."""
    
    @property
    def name(self) -> str:
        return "ideator"
    
    @observe(as_type="generation")
    def execute(self, context: StepContext) -> WorkflowResult:
        """Execute ideation step.
        
        Creates ideator agent, generates ideas from brief, stores artifacts,
        and pauses at HITL gate for approval.
        """
        try:
            # Create ideator agent
            ideator = create_agent(
                context.client,
                context.project,
                "ideator",
                context.vector_db_id,
            )
            session_id = ideator.create_session(f"run-{context.run_id}-ideator")
            
            # Generate ideas
            response = ideator.create_turn(
                messages=[{"role": "user", "content": f"Brief:\n{context.brief}"}],
                session_id=session_id,
            )
            
            ideas = extract_content(response)
            
            # Store ideas artifact
            context.artifact_repo.create(
                run_id=context.run_id,
                persona=self.name,
                artifact_type=ArtifactType.IDEAS,
                content=ideas,
                metadata={"step": self.name},
                trace_id=extract_trace_id(response),
            )
            context.run_repo.add_artifact(context.run_id, "ideas", ideas)
            
            # Parse and store structured ideation if present
            structured = parse_structured_ideation(ideas)
            if structured:
                context.artifact_repo.create(
                    run_id=context.run_id,
                    persona=self.name,
                    artifact_type=ArtifactType.IDEAS_STRUCTURED,
                    content=json.dumps(structured),
                    metadata={"step": self.name, "topic": structured.get("topic")},
                )
                context.run_repo.add_artifact(context.run_id, "ideas_structured", structured)
            
            # Update to HITL gate
            context.run_repo.update(
                context.run_id,
                status=RunStatus.AWAITING_IDEATION_APPROVAL.value,
            )
            context.run_repo.session.commit()
            
            logger.info("Ideation complete for run %s, awaiting approval", context.run_id)
            
            return WorkflowResult(
                run_id=str(context.run_id),
                status=RunStatus.AWAITING_IDEATION_APPROVAL.value,
                artifacts={"ideas": ideas, "ideas_structured": structured},
                current_step=self.name,
            )
            
        except Exception as exc:
            logger.exception("Ideation failed for run %s: %s", context.run_id, exc)
            context.run_repo.update(
                context.run_id,
                status=RunStatus.FAILED.value,
                error=str(exc),
            )
            context.run_repo.session.commit()
            
            return WorkflowResult.failure(str(context.run_id), str(exc))


def run_ideation(
    client: LlamaStackClient,
    run_id: UUID,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    project: str,
    brief: str,
    vector_db_id: str | None = None,
    notifier: Any = None,
) -> WorkflowResult:
    """Convenience function to run ideation step.
    
    Creates context and executes the step.
    """
    context = StepContext(
        run_id=run_id,
        client=client,
        run_repo=run_repo,
        artifact_repo=artifact_repo,
        project=project,
        brief=brief,
        vector_db_id=vector_db_id,
    )
    
    step = IdeationStep()
    result = step.execute(context)
    
    # Send notification
    run = run_repo.get(run_id)
    if run and result.status == RunStatus.AWAITING_IDEATION_APPROVAL.value:
        notify_telegram(
            run, notifier, "hitl_required",
            gate="ideation",
            content=result.artifacts.get("ideas", ""),
        )
    elif run and result.is_failed:
        notify_telegram(run, notifier, "failed", error=result.error, step="ideator")
    
    return result

