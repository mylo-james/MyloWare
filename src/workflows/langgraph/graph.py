"""LangGraph workflow graph definition and compilation."""

from __future__ import annotations

import asyncio
from uuid import UUID
from typing import Any, Mapping

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.memory import MemorySaver
from langgraph.constants import END, START
from langgraph.graph import StateGraph
from langgraph.types import RunnableConfig
from config import settings
from observability.logging import get_logger
from storage.repositories import RunRepository
from storage.database import get_async_session_factory

from workflows.langgraph.nodes import (
    editing_node,
    ideation_approval_node,
    ideation_node,
    production_node,
    publish_approval_node,
    publishing_node,
    wait_for_render_node,
    wait_for_videos_node,
)
from workflows.langgraph.state import VideoWorkflowState

logger = get_logger(__name__)

# Global graph instance
_graph: StateGraph[VideoWorkflowState] | None = None
_graph_kind: str | None = None  # "sqlite" | "postgres"
_async_checkpointer: AsyncPostgresSaver | None = None
_async_checkpointer_ctx: Any = None  # Context manager for checkpointer
_async_checkpointer_dsn: str | None = None


# Removed AsyncPostgresCheckpointer - using AsyncPostgresSaver directly


async def _enter_async_checkpointer() -> AsyncPostgresSaver:
    """Enter AsyncPostgresSaver context manager (idempotent)."""
    # Convert SQLAlchemy URL to psycopg format for AsyncPostgresSaver
    db_url = settings.database_url
    if db_url.startswith("sqlite"):
        raise RuntimeError(
            "LangGraph checkpoints require Postgres; configure DATABASE_URL with psycopg driver."
        )
    if db_url.startswith("postgresql+psycopg2://"):
        db_url = db_url.replace("postgresql+psycopg2://", "postgresql://")
    elif db_url.startswith("postgresql+asyncpg://"):
        db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    global _async_checkpointer, _async_checkpointer_ctx, _async_checkpointer_dsn
    current_loop = asyncio.get_running_loop()

    # If existing saver is bound to a different loop or connection closed, re-open
    if _async_checkpointer is not None:
        try:
            same_loop = getattr(_async_checkpointer, "loop", None) is current_loop
            conn_ok = hasattr(_async_checkpointer, "conn") and not getattr(
                _async_checkpointer.conn, "closed", True
            )
            if same_loop and conn_ok:
                return _async_checkpointer
        except Exception:
            pass
        # Close previous context if present
        if _async_checkpointer_ctx is not None:
            try:
                await _async_checkpointer_ctx.__aexit__(None, None, None)
            except Exception:
                pass
        _async_checkpointer = None
        _async_checkpointer_ctx = None

    _async_checkpointer_dsn = db_url
    _async_checkpointer_ctx = AsyncPostgresSaver.from_conn_string(db_url)
    _async_checkpointer = await _async_checkpointer_ctx.__aenter__()

    # Ensure tables exist (setup is required for this version)
    try:
        await asyncio.wait_for(_async_checkpointer.setup(), timeout=10.0)
        logger.info("LangGraph checkpointer tables initialized via setup()")
    except asyncio.TimeoutError:
        logger.warning("Checkpointer setup timed out (tables may already exist or DB slow)")
    except Exception as exc:
        # Table might already exist, or connection issue - log but continue
        logger.warning("Checkpointer setup failed (may already exist): %s", exc)

    return _async_checkpointer


def _get_async_checkpointer() -> AsyncPostgresSaver:
    """Get AsyncPostgresSaver checkpointer for LangGraph async execution.

    Note: This should be called after _enter_async_checkpointer() has been
    called during app startup. If not initialized, raises RuntimeError.
    """
    global _async_checkpointer
    if _async_checkpointer is None:
        raise RuntimeError(
            "AsyncPostgresSaver not initialized. "
            "Call await _enter_async_checkpointer() during app startup."
        )
    return _async_checkpointer


async def ensure_checkpointer_initialized() -> None:
    """Idempotently initialize AsyncPostgresSaver and reset graph cache only if needed.

    Rebuilding the compiled graph on every resume is concurrency-fragile; we only
    invalidate the graph when the underlying saver instance changes (e.g., loop
    mismatch or DSN change).
    """
    global _graph, _async_checkpointer
    previous = _async_checkpointer
    await _enter_async_checkpointer()
    if _async_checkpointer is not previous:
        _graph = None


def route_after_ideation_approval(state: VideoWorkflowState) -> str:
    """Route after ideation approval: continue to production or end."""
    if state.get("ideas_approved"):
        return "production"
    return END


def route_after_publish_approval(state: VideoWorkflowState) -> str:
    """Route after publish approval: continue to publishing or end."""
    if state.get("publish_approved"):
        return "publishing"
    return END


def route_after_publishing(state: VideoWorkflowState) -> str:
    """Route after publishing: finish (publish must return URLs or fail)."""
    return END


def route_after_production(state: VideoWorkflowState) -> str:
    """Route after production: skip wait_for_videos if videos already available (fake mode)."""
    if state.get("video_clips") and state.get("production_complete"):
        # Fake mode: videos already available, skip to editing
        return "editing"
    # Real mode: wait for webhooks
    return "wait_for_videos"


def route_after_editing(state: VideoWorkflowState) -> str:
    """Route after editing: skip wait_for_render if final video already available (fake mode)."""
    if state.get("final_video_url"):
        # Fake mode: final video already available, skip to publish_approval
        return "publish_approval"
    # Real mode: wait for webhook
    return "wait_for_render"


def build_video_workflow() -> StateGraph[VideoWorkflowState]:
    """Build the video production workflow graph."""
    builder = StateGraph(VideoWorkflowState)

    # Add nodes (async-capable)
    builder.add_node("ideation", ideation_node)
    builder.add_node("ideation_approval", ideation_approval_node)
    builder.add_node("production", production_node)
    builder.add_node("wait_for_videos", wait_for_videos_node)
    builder.add_node("editing", editing_node)
    builder.add_node("wait_for_render", wait_for_render_node)
    builder.add_node("publish_approval", publish_approval_node)
    builder.add_node("publishing", publishing_node)

    # Add edges
    builder.add_edge(START, "ideation")
    builder.add_edge("ideation", "ideation_approval")
    builder.add_conditional_edges(
        "ideation_approval",
        route_after_ideation_approval,
        {
            "production": "production",
            END: END,
        },
    )
    # Conditional routing: skip wait nodes in fake mode (when videos/final_video already available)
    builder.add_conditional_edges(
        "production",
        route_after_production,
        {
            "editing": "editing",  # Fake mode: videos already available
            "wait_for_videos": "wait_for_videos",  # Real mode: wait for webhooks
        },
    )
    builder.add_edge("wait_for_videos", "editing")
    builder.add_conditional_edges(
        "editing",
        route_after_editing,
        {
            "publish_approval": "publish_approval",  # Fake mode: final video already available
            "wait_for_render": "wait_for_render",  # Real mode: wait for webhook
        },
    )
    builder.add_edge("wait_for_render", "publish_approval")
    builder.add_conditional_edges(
        "publish_approval",
        route_after_publish_approval,
        {
            "publishing": "publishing",
            END: END,
        },
    )
    builder.add_conditional_edges(
        "publishing",
        route_after_publishing,
        {END: END},
    )

    return builder


def get_compiled_graph(checkpointer: AsyncPostgresSaver | MemorySaver | None = None) -> Any:
    """Compile the workflow graph with async checkpointer."""
    builder = build_video_workflow()
    if checkpointer is None:
        db_url = settings.database_url
        if db_url.startswith("sqlite"):
            logger.info("Compiling graph with in-memory checkpointer for SQLite (expected)")
            checkpointer = MemorySaver()
        else:
            # Require Postgres saver when using Postgres; fail loudly if not initialized
            checkpointer = _get_async_checkpointer()
    return builder.compile(checkpointer=checkpointer)


class _GraphWrapper:
    """Wrap compiled graph to persist DB projections on resume.

    LangGraph checkpoints are the source of truth. The runs table is a cached
    projection for legacy consumers; after any Command(resume=...), we snapshot
    the latest checkpoint into runs.
    """

    def __init__(self, graph):
        self._graph = graph

    @staticmethod
    def _thread_id_from_config(config: RunnableConfig | None) -> str | None:
        if not config:
            return None
        if isinstance(config, Mapping):
            configurable = config.get("configurable")
            if isinstance(configurable, Mapping):
                thread_id = configurable.get("thread_id")
                if isinstance(thread_id, str) and thread_id:
                    return thread_id
        return None

    @staticmethod
    def _without_checkpoint_id(config: RunnableConfig | None) -> RunnableConfig | None:
        """Return a shallow copy of config without checkpoint_id.

        Passing checkpoint_id in config triggers time travel. When projecting
        the latest state into the DB we must *not* pin to a historical checkpoint,
        otherwise the runs table can be overwritten with stale status/current_step.
        """
        if not config or not isinstance(config, Mapping):
            return config
        cfg = dict(config)
        configurable = cfg.get("configurable")
        if isinstance(configurable, Mapping):
            new_conf = dict(configurable)
            new_conf.pop("checkpoint_id", None)
            cfg["configurable"] = new_conf
        return cfg

    async def _persist_run_snapshot(self, config: RunnableConfig | None, result: Any | None = None) -> None:
        """Best-effort persist status/current_step/error from LangGraph state to DB.

        This runs after any resume so observers reading from the runs table don't
        see stale HITL/awaiting states.
        """
        thread_id = self._thread_id_from_config(config)
        if not thread_id:
            return
        try:
            latest_config = self._without_checkpoint_id(config)
            graph_state = await self._graph.aget_state(latest_config)
            state_values = (
                dict(graph_state.values)
                if graph_state and getattr(graph_state, "values", None)
                else {}
            )
            if isinstance(result, dict):
                # Merge deltas over checkpoint values.
                state_values = {**state_values, **result}

            update_kwargs: dict[str, Any] = {}
            if state_values.get("status"):
                update_kwargs["status"] = state_values["status"]
            if state_values.get("current_step"):
                update_kwargs["current_step"] = state_values["current_step"]
            if "error" in state_values:
                update_kwargs["error"] = state_values.get("error")

            if not update_kwargs:
                return

            SessionLocal = get_async_session_factory()
            async with SessionLocal() as session:
                run_repo = RunRepository(session)
                await run_repo.update_async(UUID(thread_id), **update_kwargs)
                await session.commit()
        except Exception as exc:  # pragma: no cover - defensive logging only
            logger.warning("Failed to persist LangGraph snapshot for %s: %s", thread_id, exc)

    async def ainvoke(self, input, config=None, **kwargs):
        from langgraph.types import Command

        is_resume = isinstance(input, Command) and getattr(input, "resume", None) is not None
        result = await self._graph.ainvoke(input, config=config, **kwargs)
        if is_resume:
            await self._persist_run_snapshot(config, result)
        return result

    def __getattr__(self, item):
        return getattr(self._graph, item)


def get_graph() -> Any:
    """Get singleton compiled graph instance."""
    global _graph, _graph_kind
    db_url = settings.database_url
    desired_kind = "sqlite" if db_url.startswith("sqlite") else "postgres"

    # Rebuild when switching between sqlite and postgres modes (tests frequently mutate DATABASE_URL).
    if _graph is None or _graph_kind != desired_kind:
        _graph_kind = desired_kind
        if desired_kind == "sqlite":
            logger.info("Compiling LangGraph workflow with MemorySaver (SQLite mode)")
            _graph = _GraphWrapper(get_compiled_graph(checkpointer=MemorySaver()))
        else:
            checkpointer = _get_async_checkpointer()
            logger.info("Compiling LangGraph workflow with AsyncPostgresSaver")
            _graph = _GraphWrapper(get_compiled_graph(checkpointer=checkpointer))
    return _graph


async def _exit_async_checkpointer() -> None:
    """Exit AsyncPostgresSaver context manager (call from app shutdown)."""
    global _async_checkpointer, _async_checkpointer_ctx
    if _async_checkpointer_ctx and _async_checkpointer:
        try:
            await _async_checkpointer_ctx.__aexit__(None, None, None)
        except Exception as exc:
            logger.warning("Error closing async checkpointer: %s", exc)
    _async_checkpointer = None
    _async_checkpointer_ctx = None


def clear_graph_cache() -> None:
    """Clear the graph cache (useful for testing)."""
    global _graph, _graph_kind, _async_checkpointer, _async_checkpointer_ctx
    _graph = None
    _graph_kind = None
    # Keep _async_checkpointer so initialization persists across rebuilds


async def check_checkpointer_health() -> bool:
    """Verify AsyncPostgresSaver connectivity (used by health endpoint)."""
    if settings.database_url.startswith("sqlite"):
        return True
    try:
        await ensure_checkpointer_initialized()
        saver = _get_async_checkpointer()
        # lightweight no-op: ensure tables exist
        await asyncio.wait_for(saver.setup(), timeout=5.0)
        return True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Checkpointer health check failed: %s", exc)
        return False
