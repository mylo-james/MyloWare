"""Workflow orchestrator - thin coordinator for multi-agent pipelines.

This module coordinates workflow execution by delegating to step modules:
- steps/ideation.py: Generate ideas from brief
- steps/production.py: Generate video clips
- steps/editing.py: Compose final video
- steps/publishing.py: Publish to platforms

Helpers are in:
- helpers.py: Shared utilities (notifications, caching, etc.)
- parsers.py: Text parsing utilities
- state.py: WorkflowResult and state types
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional
from uuid import UUID

from langfuse import observe
from llama_stack_client import LlamaStackClient

from config.projects import load_project
from notifications.telegram import TelegramNotifier
from storage.models import RunStatus
from storage.repositories import ArtifactRepository, RunRepository

# Import from modules
from workflows.helpers import notify_telegram
from workflows.state import WorkflowResult
from workflows.steps import (
    run_ideation,
    run_production,
    run_publishing,
)
from workflows.steps.base import StepContext
from workflows.steps.editing import continue_to_editor

logger = logging.getLogger(__name__)

__all__ = [
    "run_workflow",
    "run_workflow_async",
    "create_pending_run",
    "WorkflowResult",
    "continue_after_ideation",
    "continue_after_producer",
    "continue_after_publish_approval",
]


@observe(name="create_pending_run")
def create_pending_run(
    run_repo: RunRepository,
    workflow_name: str,
    brief: str,
    user_id: Optional[str] = None,
    telegram_chat_id: Optional[str] = None,
) -> UUID:
    """Create a new pending run entry in the database."""
    load_project(workflow_name)  # Validate project exists

    run = run_repo.create(
        workflow_name=workflow_name,
        user_id=user_id,
        input=brief,
        status=RunStatus.PENDING,
        telegram_chat_id=telegram_chat_id,
    )
    run_repo.session.commit()
    logger.info("Created pending run: %s", run.id)
    return run.id


@observe()
def run_workflow_async(
    client: LlamaStackClient,
    run_id: UUID,
    vector_db_id: str,
    notifier: TelegramNotifier | None = None,
) -> None:
    """Execute workflow for an existing pending run (background execution)."""
    from storage.database import get_session
    
    with get_session() as session:
        run_repo = RunRepository(session)
        artifact_repo = ArtifactRepository(session)
        
        run = run_repo.get(run_id)
        if run is None:
            logger.error("Run not found for async execution: %s", run_id)
            return

        try:
            run_repo.update(run_id, status=RunStatus.RUNNING.value)
            session.commit()
            
            notify_telegram(run, notifier, "started")
            load_project(run.workflow_name)

            # Run ideation step
            result = run_ideation(
                client=client,
                run_id=run_id,
                run_repo=run_repo,
                artifact_repo=artifact_repo,
                project=run.workflow_name,
                brief=run.input or "",
                vector_db_id=vector_db_id,
                notifier=notifier,
            )
            
            logger.info("Async workflow completed ideation for run: %s", run_id)

        except Exception as exc:
            logger.exception("Async workflow failed for run %s: %s", run_id, exc)
            run_repo.update(run_id, status=RunStatus.FAILED.value, error=str(exc))
            session.commit()
            notify_telegram(run, notifier, "failed", error=str(exc), step="ideator")


def run_workflow(
    client: LlamaStackClient,
    brief: str,
    vector_db_id: str,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    workflow_name: str = "aismr",
    user_id: Optional[str] = None,
    telegram_chat_id: Optional[str] = None,
    notifier: TelegramNotifier | None = None,
) -> WorkflowResult:
    """Execute workflow until ideation gate, then pause for approval."""
    load_project(workflow_name)

    run = run_repo.create(
        workflow_name=workflow_name,
        user_id=user_id,
        input=brief,
        status=RunStatus.RUNNING,
        telegram_chat_id=telegram_chat_id,
    )
    run_repo.session.commit()
    
    notify_telegram(run, notifier, "started")

    return run_ideation(
        client=client,
        run_id=run.id,
        run_repo=run_repo,
        artifact_repo=artifact_repo,
        project=workflow_name,
        brief=brief,
        vector_db_id=vector_db_id,
        notifier=notifier,
    )


@observe()
def continue_after_ideation(
    client: LlamaStackClient,
    run_id: UUID,
    vector_db_id: str,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    notifier: TelegramNotifier | None = None,
) -> WorkflowResult:
    """Continue workflow after ideation approval - run Producer."""
    return run_production(
        client=client,
        run_id=run_id,
        run_repo=run_repo,
        artifact_repo=artifact_repo,
        vector_db_id=vector_db_id,
        notifier=notifier,
    )


@observe()
async def continue_after_producer(run_id: UUID) -> WorkflowResult:
    """Continue workflow after KIE.ai webhooks complete - run Editor."""
    return await continue_to_editor(run_id)


@observe()
def continue_after_publish_approval(
    client: LlamaStackClient,
    run_id: UUID,
    vector_db_id: str,
    run_repo: RunRepository,
    artifact_repo: ArtifactRepository,
    notifier: TelegramNotifier | None = None,
) -> WorkflowResult:
    """Continue workflow after publish approval - execute Publisher."""
    return run_publishing(
        client=client,
        run_id=run_id,
        run_repo=run_repo,
        artifact_repo=artifact_repo,
        vector_db_id=vector_db_id,
        notifier=notifier,
    )
