"""Async execution of production graphs."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, cast

from .run_state import RunState
from .checkpointer import PostgresCheckpointer
from .config import settings
from .langsmith_tracing import (
    start_langsmith_run,
    end_langsmith_run,
)

logger = logging.getLogger("myloware.orchestrator.executor")


async def execute_production_graph(
    graph: Any,
    run_id: str,
    initial_state: RunState,
    checkpointer: PostgresCheckpointer | None = None,
) -> None:
    """Execute a production graph asynchronously.
    
    Args:
        graph: Compiled LangGraph
        run_id: Unique run identifier (used as thread_id)
        initial_state: Initial state for the graph
        checkpointer: Optional checkpointer (creates one if None)
    """
    if checkpointer is None:
        checkpointer = PostgresCheckpointer(settings.db_url)

    # Start a LangSmith root run for this Brendan run (best-effort)
    project = initial_state.get("project")
    ls_run = start_langsmith_run(
        name=f"{project}-graph" if project else "brendan-graph",
        inputs={
            "run_id": run_id,
            "project": project,
        },
        tags=[f"runId:{run_id}", f"project:{project}", f"providers_mode:{settings.providers_mode}"],
        metadata={
            "run_id": run_id,
            "project": project,
            "providers_mode": settings.providers_mode,
        },
    )

    try:
        invoke_state: RunState = cast(RunState, dict(initial_state))
        if ls_run is not None:
            invoke_state["_langsmith_run"] = ls_run
        # Execute graph with checkpointing
        config = {"configurable": {"thread_id": run_id}}

        # Invoke graph (this is synchronous, but we run it in executor)
        result_state = graph.invoke(invoke_state, config=config)
        if ls_run is not None and isinstance(result_state, dict):
            result_state.pop("_langsmith_run", None)

        # Save final checkpoint
        checkpointer.save(run_id, result_state)

        logger.info(
            "Production graph completed",
            extra={"run_id": run_id, "project": project},
        )

        # Finish LangSmith run with final status
        end_langsmith_run(
            ls_run,
            outputs={
                "status": "completed",
                "run_id": run_id,
                "project": project,
            },
        )

        # Send notification to Brendan on completion
        try:
            import httpx

            api_base_url = settings.api_base_url
            api_key = settings.api_key

            httpx.post(
                f"{api_base_url}/v1/notifications/graph/{run_id}",
                json={
                    "notification_type": "completed",
                    "message": f"Run {run_id} completed successfully.",
                },
                headers={"x-api-key": api_key},
                timeout=5.0,
            )
        except Exception as notify_exc:
            logger.warning("Failed to send completion notification", exc_info=notify_exc)

    except Exception as exc:
        logger.error("Production graph execution failed", exc_info=exc, extra={"run_id": run_id})
        # Save error state
        sanitized_initial = dict(initial_state)
        sanitized_initial.pop("_langsmith_run", None)
        error_state = {
            **sanitized_initial,
            "completed": False,
            "metadata": {
                **sanitized_initial.get("metadata", {}),
                "error": str(exc),
            },
        }
        checkpointer.save(run_id, error_state)
        # Finish LangSmith run with error
        end_langsmith_run(
            ls_run,
            error=str(exc),
            outputs={
                "status": "error",
                "run_id": run_id,
                "project": initial_state.get("project"),
            },
        )
        raise


def execute_production_graph_sync(
    graph: Any,
    run_id: str,
    initial_state: RunState,
    checkpointer: PostgresCheckpointer | None = None,
) -> RunState:
    """Execute a production graph synchronously (for testing).
    
    Returns the final state.
    """
    if checkpointer is None:
        checkpointer = PostgresCheckpointer(settings.db_url)

    project = initial_state.get("project")
    ls_run = start_langsmith_run(
        name=f"{project}-graph" if project else "brendan-graph",
        inputs={
            "run_id": run_id,
            "project": project,
        },
        tags=[f"runId:{run_id}", f"project:{project}", f"providers_mode:{settings.providers_mode}"],
        metadata={
            "run_id": run_id,
            "project": project,
            "providers_mode": settings.providers_mode,
        },
    )

    try:
        config = {"configurable": {"thread_id": run_id}}
        invoke_state: RunState = cast(RunState, dict(initial_state))
        if ls_run is not None:
            invoke_state["_langsmith_run"] = ls_run
        result_state = cast(RunState, graph.invoke(invoke_state, config=config))
        if ls_run is not None and isinstance(result_state, dict):
            result_state.pop("_langsmith_run", None)
        checkpointer.save(run_id, dict(result_state))
        end_langsmith_run(
            ls_run,
            outputs={
                "status": "completed",
                "run_id": run_id,
                "project": project,
            },
        )
        return result_state
    except Exception as exc:
        sanitized = dict(initial_state)
        sanitized.pop("_langsmith_run", None)
        end_langsmith_run(
            ls_run,
            error=str(exc),
            outputs={
                "status": "error",
                "run_id": run_id,
                "project": project or sanitized.get("project"),
            },
        )
        raise
