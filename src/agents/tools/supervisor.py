"""Supervisor tools for workflow control."""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Iterable
from uuid import UUID

from client import get_client
from storage.database import get_session
from storage.repositories import ArtifactRepository, RunRepository
from tools.base import MylowareBaseTool, ToolParamDefinition

logger = logging.getLogger(__name__)


def _run_repo_factory() -> RunRepository:
    with get_session() as session:
        return RunRepository(session)


def _artifact_repo_factory() -> ArtifactRepository:
    with get_session() as session:
        return ArtifactRepository(session)


class StartWorkflowTool(MylowareBaseTool):
    """Start a video production workflow."""

    def __init__(
        self,
        client_factory: Callable[[], Any] = get_client,
        run_repo_factory: Callable[[], RunRepository] | None = None,
        artifact_repo_factory: Callable[[], ArtifactRepository] | None = None,
        vector_db_id: str = "project_kb",
        orchestrator: Callable[..., Any] | None = None,
    ):
        self.client_factory = client_factory
        self.run_repo_factory = run_repo_factory
        self.artifact_repo_factory = artifact_repo_factory
        self.vector_db_id = vector_db_id
        self.orchestrator = orchestrator

    def get_name(self) -> str:
        return "start_workflow"

    def get_description(self) -> str:
        return "Start a video production workflow for a project. Returns run_id and status."

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "project": ToolParamDefinition(
                param_type="str",
                description="Project name",
                required=True,
            ),
            "brief": ToolParamDefinition(
                param_type="str",
                description="Short brief for the run",
                required=True,
            ),
            "user_id": ToolParamDefinition(
                param_type="str",
                description="User identifier (e.g., telegram_<chat_id>)",
                required=False,
            ),
            "telegram_chat_id": ToolParamDefinition(
                param_type="str",
                description="Telegram chat id for notifications",
                required=False,
            ),
        }

    def run_impl(
        self,
        project: str,
        brief: str,
        user_id: str | None = None,
        telegram_chat_id: str | None = None,
    ) -> Dict[str, Any]:
        client = self.client_factory()

        orchestrator = self.orchestrator
        if orchestrator is None:
            from workflows.orchestrator import run_workflow as _run_workflow

            orchestrator = _run_workflow

        if self.run_repo_factory and self.artifact_repo_factory:
            run_repo = self.run_repo_factory()
            artifact_repo = self.artifact_repo_factory()
            result = orchestrator(
                client=client,
                brief=brief,
                vector_db_id=self.vector_db_id,
                run_repo=run_repo,
                artifact_repo=artifact_repo,
                workflow_name=project,
                user_id=user_id,
                telegram_chat_id=telegram_chat_id,
            )
            # Handle status as either Enum or string
            status = result.status.value if hasattr(result.status, 'value') else result.status
            return {
                "run_id": str(result.run_id),
                "status": status,
                "current_step": result.current_step,
            }

        # Default path uses DB session context
        with get_session() as session:
            run_repo = RunRepository(session)
            artifact_repo = ArtifactRepository(session)
            result = orchestrator(
                client=client,
                brief=brief,
                vector_db_id=self.vector_db_id,
                run_repo=run_repo,
                artifact_repo=artifact_repo,
                workflow_name=project,
                user_id=user_id,
                telegram_chat_id=telegram_chat_id,
            )
            # Handle status as either Enum or string
            status = result.status.value if hasattr(result.status, 'value') else result.status
            return {
                "run_id": str(result.run_id),
                "status": status,
                "current_step": result.current_step,
            }


class GetRunStatusTool(MylowareBaseTool):
    """Get status of a run."""

    def __init__(
        self,
        run_repo_factory: Callable[[], RunRepository] | None = None,
    ):
        self.run_repo_factory = run_repo_factory

    def get_name(self) -> str:
        return "get_run_status"

    def get_description(self) -> str:
        return "Retrieve status, current_step, and artifacts for a run."

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "run_id": ToolParamDefinition(
                param_type="str",
                description="Run identifier",
                required=True,
            ),
        }

    def run_impl(self, run_id: str) -> Dict[str, Any]:
        if self.run_repo_factory:
            repo = self.run_repo_factory()
            run = repo.get(UUID(run_id)) if run_id else None
            if run is None:
                raise ValueError("Run not found")
            return {
                "run_id": str(run.id),
                "workflow_name": run.workflow_name,
                "status": run.status,
                "current_step": run.current_step,
                "artifacts": run.artifacts or {},
            }

        with get_session() as session:
            repo = RunRepository(session)
            run = repo.get(UUID(run_id))
            if run is None:
                raise ValueError("Run not found")
            return {
                "run_id": str(run.id),
                "workflow_name": run.workflow_name,
                "status": run.status,
                "current_step": run.current_step,
                "artifacts": run.artifacts or {},
            }


class ListRunsTool(MylowareBaseTool):
    """List recent runs."""

    def __init__(
        self,
        run_repo_factory: Callable[[], RunRepository] | None = None,
    ):
        self.run_repo_factory = run_repo_factory

    def get_name(self) -> str:
        return "list_runs"

    def get_description(self) -> str:
        return "List recent workflow runs."

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "limit": ToolParamDefinition(
                param_type="int",
                description="Max runs to return",
                required=False,
                default=10,
            ),
        }

    def run_impl(self, limit: int = 10) -> Dict[str, Iterable[Dict[str, Any]]]:
        limit = int(limit)
        if self.run_repo_factory:
            repo = self.run_repo_factory()
            runs = repo.list(limit=limit)
        else:
            with get_session() as session:
                repo = RunRepository(session)
                runs = repo.list(limit=limit)

        def _serialize(run):
            if hasattr(run, "__dict__"):
                return {
                    "run_id": str(getattr(run, "id", None)) if run else None,
                    "workflow_name": getattr(run, "workflow_name", None),
                    "status": getattr(run, "status", None),
                    "current_step": getattr(run, "current_step", None),
                }
            if isinstance(run, dict):
                return {
                    "run_id": str(run.get("id")),
                    "workflow_name": run.get("workflow_name"),
                    "status": run.get("status"),
                    "current_step": run.get("current_step"),
                }
            return {}

        return {"runs": [_serialize(r) for r in runs]}


class ApproveGateTool(MylowareBaseTool):
    """Approve a HITL gate for a run."""

    def __init__(
        self,
        client_factory: Callable[[], Any] = get_client,
        run_repo_factory: Callable[[], RunRepository] | None = None,
        artifact_repo_factory: Callable[[], ArtifactRepository] | None = None,
        vector_db_id: str = "project_kb",
        gate_approver: Callable[..., Any] | None = None,
    ):
        self.client_factory = client_factory
        self.run_repo_factory = run_repo_factory
        self.artifact_repo_factory = artifact_repo_factory
        self.vector_db_id = vector_db_id
        self.gate_approver = gate_approver

    def get_name(self) -> str:
        return "approve_gate"

    def get_description(self) -> str:
        return "Approve a HITL gate for a run."

    def get_params_definition(self) -> Dict[str, ToolParamDefinition]:
        return {
            "run_id": ToolParamDefinition(
                param_type="str",
                description="Run identifier",
                required=True,
            ),
            "gate": ToolParamDefinition(
                param_type="str",
                description="Gate name (ideation|publish)",
                required=True,
            ),
            "content_override": ToolParamDefinition(
                param_type="str",
                description="Optional content override",
                required=False,
            ),
        }

    def run_impl(
        self, run_id: str, gate: str, content_override: str | None = None
    ) -> Dict[str, Any]:
        client = self.client_factory()

        gate_approver = self.gate_approver
        if gate_approver is None:
            from workflows.hitl import approve_gate as _approve_gate

            gate_approver = _approve_gate

        if self.run_repo_factory and self.artifact_repo_factory:
            run_repo = self.run_repo_factory()
            artifact_repo = self.artifact_repo_factory()
            result = gate_approver(
                client=client,
                run_id=UUID(run_id),
                gate=gate,
                run_repo=run_repo,
                artifact_repo=artifact_repo,
                vector_db_id=self.vector_db_id,
                content_override=content_override,
            )
            # Handle status as either Enum or string
            status = result.status.value if hasattr(result.status, 'value') else result.status
            return {
                "run_id": str(result.run_id),
                "status": status,
                "current_step": result.current_step,
            }

        with get_session() as session:
            run_repo = RunRepository(session)
            artifact_repo = ArtifactRepository(session)
            result = gate_approver(
                client=client,
                run_id=UUID(run_id),
                gate=gate,
                run_repo=run_repo,
                artifact_repo=artifact_repo,
                vector_db_id=self.vector_db_id,
                content_override=content_override,
            )
            # Handle status as either Enum or string
            status = result.status.value if hasattr(result.status, 'value') else result.status
            return {
                "run_id": str(result.run_id),
                "status": status,
                "current_step": result.current_step,
            }


__all__ = [
    "StartWorkflowTool",
    "GetRunStatusTool",
    "ListRunsTool",
    "ApproveGateTool",
]
