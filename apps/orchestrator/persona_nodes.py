"""Factory for creating persona-specific agent nodes."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Mapping, MutableMapping, Sequence, cast

import httpx

try:
    from langchain_core.tools import tool
    from langchain.agents import create_agent
    from langchain_openai import ChatOpenAI
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
from pydantic import BaseModel

from content.editing.timeline import build_concatenated_timeline

from .run_state import RunState
from .config import settings
from .state_utils import append_persona_message, collect_artifacts
from .persona_context import build_persona_context
from .persona_prompts import (
    build_persona_user_message as _persona_build_persona_user_message,
    compose_system_prompt as _persona_compose_system_prompt,
    load_persona_prompt as _persona_load_persona_prompt,
    project_specs as _persona_project_specs,
)
from .persona_runtime import (
    count_artifacts_of_type,
    handle_optional_persona,
    resolve_project_spec_for_state,
    run_mock_persona,
)
from .run_observer import observe_run_progress, _get_run_snapshot as _observer_fetch_snapshot
from . import persona_tools
from .citations import build_citations, append_citations
from .langsmith_tracing import start_langsmith_child_run, end_langsmith_child_run
from .metrics import persona_allowlist_failures_total
from .persona_contracts import _PERSONA_CONTRACTS, _validate_persona_contract

try:
    from core.knowledge.retrieval import search_kb
    RETRIEVAL_AVAILABLE = True
except ImportError:
    RETRIEVAL_AVAILABLE = False

logger = logging.getLogger("myloware.orchestrator.persona_nodes")
# Ensure persona prompt loading logs remain visible even if the root logger uses
# a higher default level in certain environments by attaching a lightweight
# stream handler when none are configured.
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(handler)
_TEST_ALLOWED_TOOLS: dict[str, list[str]] = {}
_TEST_CONTEXT_CALLS: list[tuple[RunState, dict[str, Any], str]] = []


_LANGCHAIN_PERSONA_PROJECTS = {"aismr", "test_video_gen"}


def _get_run_snapshot(run_id: str) -> dict[str, Any]:
    """Shim for legacy tests that monkeypatch persona_nodes._get_run_snapshot."""
    return _observer_fetch_snapshot(run_id)

def _load_persona_prompt(persona: str) -> str:
    """Shim maintained for backwards compatibility."""
    return _persona_load_persona_prompt(persona)



def _compose_system_prompt(persona: str, context: Mapping[str, Any]) -> str:
    """Shim maintained for backwards compatibility."""
    return _persona_compose_system_prompt(persona, context)


def _project_specs(project_spec: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """Shim maintained for backwards compatibility."""
    return _persona_project_specs(project_spec)




def _resolve_project_videos(state: Mapping[str, Any], project_spec: Mapping[str, Any]) -> list[dict[str, Any]]:
    specs = _project_specs(project_spec)
    target = int(specs.get("videoCount") or 0)
    videos = state.get("videos")
    resolved: list[dict[str, Any]] = []
    if isinstance(videos, list):
        resolved = [dict(video) for video in videos]
    elif isinstance(specs, Mapping):
        template_videos = specs.get("videos")
        if isinstance(template_videos, list):
            resolved = [dict(video) for video in template_videos]
    if target and len(resolved) < target:
        for idx in range(len(resolved), target):
            resolved.append(
                {
                    "index": idx,
                    "subject": f"{state.get('project', 'clip')} subject {idx+1}",
                    "header": f"Variant {idx+1}",
                }
            )
    for idx, video in enumerate(resolved):
        video.setdefault("index", idx)
    return resolved


def _build_persona_user_message(persona: str, context: Mapping[str, Any], state: Mapping[str, Any]) -> str:
    """Shim maintained for backwards compatibility."""
    return _persona_build_persona_user_message(persona, context, state)


class MemorySearchInput(BaseModel):
    query: str | None = None
    queries: Sequence[str] | None = None
    k: int = 5


class VideoPromptPayload(BaseModel):
    index: int
    prompt: str
    duration: int | None = None
    aspectRatio: str | None = None
    quality: str | None = None
    model: str | None = None
    metadata: dict[str, Any] | None = None
    subject: str | None = None
    header: str | None = None


class ShotstackClipAsset(BaseModel):
    type: str
    src: str | None = None
    text: str | None = None
    style: str | None = None
    size: str | None = None
    color: str | None = None
    background: str | None = None


class ShotstackClip(BaseModel):
    asset: ShotstackClipAsset
    start: float
    length: float
    position: str | None = None
    offset: dict[str, float] | None = None


class ShotstackTrack(BaseModel):
    clips: list[ShotstackClip]


class ShotstackOutputSpec(BaseModel):
    format: str
    resolution: str | None = None
    aspectRatio: str | None = None
    fps: float | None = None


class ShotstackTimelinePayload(BaseModel):
    # Full Shotstack timeline object; we keep it flexible to match the API JSON.
    timeline: dict[str, Any]
    output: ShotstackOutputSpec | None = None


class RenderTimelineInput(BaseModel):
    # Optional Shotstack edit payload. If omitted, the tool builds a template timeline.
    timeline: dict[str, Any] | None = None
    clips: Sequence[dict[str, Any]] | None = None
    overlay_style: dict[str, Any] | None = None
    output: dict[str, Any] | None = None
    run_id: str | None = None


def _build_memory_search_tool(state: RunState, persona: str, project: str):
    @tool("memory_search", args_schema=MemorySearchInput)
    def memory_search_tool(query: str | None = None, queries: Sequence[str] | None = None, k: int = 5) -> str:
        """Search project/persona knowledge base."""
        if not RETRIEVAL_AVAILABLE:
            logger.warning(
                "Persona attempted memory search without retrieval support",
                extra={"persona": persona, "project": project},
            )
            return "retrieval unavailable"
        query_list: list[str]
        if queries is None and query:
            query_list = [query]
        elif queries is not None:
            if isinstance(queries, str):
                query_list = [queries]
            else:
                query_list = [str(item).strip() for item in queries if str(item).strip()]
        else:
            query_list = []
        if not query_list:
            return "no queries provided"
        responses: list[str] = []
        try:
            dsn = settings.db_url.replace("postgresql+psycopg://", "postgresql://", 1)
            for query in query_list:
                results, latency_ms = search_kb(dsn, query, k=k, project=project, persona=persona)
                trace = {
                    "query": query,
                    "persona": persona,
                    "project": project,
                    "topK": k,
                    "docIds": [doc_id for doc_id, _, _, _ in results],
                    "similarities": [float(score) for _, _, score, _ in results],
                    "latency_ms": latency_ms,
                }
                if "retrieval_traces" not in state:
                    state["retrieval_traces"] = []
                state["retrieval_traces"].append(trace)
                citations = build_citations(results, reason=f"{persona} memory search: {query}")
                append_citations(cast(MutableMapping[str, object], state), citations)
                artifacts = collect_artifacts(
                    state,
                    {
                        "type": "retrieval.trace",
                        "persona": persona,
                        "project": project,
                        "provider": "orchestrator",
                        "trace": trace,
                    },
                    {
                        "type": "citations",
                        "persona": persona,
                        "project": project,
                        "provider": "orchestrator",
                        "items": citations,
                    },
                )
                state["artifacts"] = artifacts
                lines = [
                    f"{i+1}. {path} (score {score:.3f}) — {snippet[:200]}"
                    for i, (doc_id, path, score, snippet) in enumerate(results)
                ]
                logger.info(
                    "Persona memory search completed",
                    extra={
                        "persona": persona,
                        "project": project,
                        "run_id": state.get("run_id"),
                        "query": query,
                        "doc_count": len(results),
                        "latency_ms": latency_ms,
                    },
                )
                responses.append(f"Query: {query}\n" + ("\n".join(lines) if lines else "no results"))
            return "\n\n".join(responses)
        except Exception as exc:
            logger.error(
                "RAG search failed",
                exc_info=exc,
                extra={"persona": persona, "project": project, "queries": query_list},
            )
            return f"retrieval error: {exc}"

    return memory_search_tool


def _build_transfer_tool(name: str, target: str, state: RunState, persona: str, project: str):
    @tool(name)
    def transfer_tool() -> str:
        """Request a handoff to another persona inside the LangGraph run."""
        logger.info(
            "Persona requested transfer",
            extra={"persona": persona, "project": project, "target": target},
        )
        return f"transferring to {target}"

    return transfer_tool


class SubmitGenerationJobsInput(BaseModel):
    videos: Sequence[VideoPromptPayload]
    run_id: str | None = None


def _build_submit_generation_jobs_tool(state: RunState, persona: str, project: str):
    run_id_from_state = str(state.get("run_id") or "")

    @tool("submit_generation_jobs_tool", args_schema=SubmitGenerationJobsInput)
    def submit_tool(videos: Sequence[VideoPromptPayload], run_id: str | None = None) -> str:
        """Submit kie.ai video generation jobs for the current run."""
        actual_run_id = run_id or run_id_from_state
        if not actual_run_id:
            raise ValueError("run_id is required for submit_generation_jobs_tool")
        logger.info(
            "Persona submitting generation jobs",
            extra={"persona": persona, "project": project, "run_id": actual_run_id},
        )
        payload = [video.model_dump(exclude_none=True) for video in videos]
        return persona_tools.submit_generation_jobs_tool(videos=payload, run_id=actual_run_id)

    return submit_tool


def _build_wait_for_generations_tool(state: RunState, persona: str, project: str):
    run_id_from_state = str(state.get("run_id") or "")

    @tool("wait_for_generations_tool")
    def wait_tool(expected_count: int, timeout_minutes: float = 10.0, run_id: str | None = None) -> str:
        """Polls run state until the requested number of clips are ready."""
        target_run = run_id or run_id_from_state
        if not target_run:
            raise ValueError("run_id is required for wait_for_generations_tool")
        logger.info(
            "Persona waiting for kie.ai generations",
            extra={
                "persona": persona,
                "project": project,
                "run_id": target_run,
                "expected_count": expected_count,
                "timeout_minutes": timeout_minutes,
            },
        )
        return persona_tools.wait_for_generations_tool(
            target_run,
            expected_count=expected_count,
            timeout_minutes=timeout_minutes,
        )

    return wait_tool


def _build_render_video_timeline_tool(state: RunState, persona: str, project: str):
    run_id_from_state = str(state.get("run_id") or "")

    @tool("render_video_timeline_tool", args_schema=RenderTimelineInput)
    def render_tool(
        timeline: dict[str, Any] | None = None,
        clips: Sequence[dict[str, Any]] | None = None,
        overlay_style: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
        run_id: str | None = None,
    ) -> str:
        """Submit a Shotstack timeline for rendering or auto-build one from run clips.

        Contract:
        - Alex should call this tool exactly once per run when editing is ready.
        - If providing a full Shotstack payload, pass it via `timeline`.
        - Otherwise omit `timeline` and the tool will auto-build a concatenated timeline
          from generated clips (optionally overriding overlays/output).
        - On successful render, subsequent calls are blocked to avoid re-rendering.
        """
        target_run = run_id or run_id_from_state
        if not target_run:
            raise ValueError("run_id is required for render_video_timeline_tool")
        if state.get("_render_succeeded"):
            return (
                "render_video_timeline_tool has already been called successfully "
                "for this run. Do not call it again; describe the existing render."
            )
        logger.info(
            "Persona rendering timeline",
            extra={"persona": persona, "project": project, "run_id": target_run},
        )
        # Track attempt count for observability.
        try:
            state["_render_attempts"] = int(state.get("_render_attempts", 0)) + 1
        except Exception:  # pragma: no cover - defensive
            state["_render_attempts"] = 1
        try:
            result = persona_tools.render_video_timeline_tool(
                target_run,
                timeline=dict(timeline) if timeline is not None else None,
                clips=clips,
                overlay_style=overlay_style,
                output_settings=output,
            )
            # Mark success so further calls are blocked.
            state["_render_succeeded"] = True
            return result
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Shotstack render returned HTTP error",
                extra={
                    "persona": persona,
                    "project": project,
                    "run_id": target_run,
                    "status": exc.response.status_code if exc.response else None,
                },
                exc_info=True,
            )
            status = exc.response.status_code if exc.response else "unknown"
            return (
                "Shotstack render failed "
                f"(status {status}): {exc.response.text if exc.response else exc}. "
                "This indicates a Shotstack or rendering infrastructure issue for this run; surface this error to a human reviewer instead of attempting to adjust the timeline yourself."
            )
        except Exception as exc:  # pragma: no cover - defensive catch
            logger.warning(
                "Shotstack render failed",
                extra={"persona": persona, "project": project, "run_id": target_run},
                exc_info=True,
            )
            return (
                "Shotstack render failed due to an internal error "
                f"({exc}). Treat this as a system rendering problem: report the failure with the run_id and do not retry renders unless explicitly instructed."
            )

    return render_tool


def _build_publish_to_tiktok_tool(state: RunState, persona: str, project: str):
    run_id_from_state = str(state.get("run_id") or "")

    @tool("publish_to_tiktok_tool")
    def publish_tool(caption: str, run_id: str | None = None, video_url: str | None = None) -> str:
        """Upload the final video via the upload-post API (TikTok MVP).

        The video URL is resolved automatically from the run's render artifacts;
        the optional ``video_url`` parameter is accepted for backwards
        compatibility but ignored.
        """
        target_run = run_id or run_id_from_state
        if not target_run:
            raise ValueError("run_id is required for publish_to_tiktok_tool")
        logger.info(
            "Persona publishing video",
            extra={"persona": persona, "project": project, "run_id": target_run},
        )
        return persona_tools.publish_to_tiktok_tool(caption=caption, run_id=target_run)

    return publish_tool


def _register_persona_tools(
    state: RunState,
    persona: str,
    project: str,
    allowed_tool_names: list[str],
) -> tuple[list[Any], dict[str, Any]]:
    mode = str(getattr(settings, "persona_allowlist_mode", "fail_fast")).strip().lower()
    fail_fast = mode == "fail_fast"

    registry: dict[str, Any] = {
        "memory_search": _build_memory_search_tool(state, persona, project),
        "transfer_to_alex": _build_transfer_tool("transfer_to_alex", "alex", state, persona, project),
        "transfer_to_quinn": _build_transfer_tool("transfer_to_quinn", "quinn", state, persona, project),
        "transfer_to_riley": _build_transfer_tool("transfer_to_riley", "riley", state, persona, project),
        "submit_generation_jobs_tool": _build_submit_generation_jobs_tool(state, persona, project),
        "wait_for_generations_tool": _build_wait_for_generations_tool(state, persona, project),
        "render_video_timeline_tool": _build_render_video_timeline_tool(state, persona, project),
        "publish_to_tiktok_tool": _build_publish_to_tiktok_tool(state, persona, project),
    }

    normalized_allowed = [name for name in (allowed_tool_names or []) if name]
    if not normalized_allowed:
        if fail_fast:
            persona_allowlist_failures_total.labels(
                persona=str(persona).lower(),
                project=str(project),
                mode=mode,
            ).inc()
            raise RuntimeError(
                f"Persona '{persona}' in project '{project}' has no allowed tools configured. "
                "Check agent-expectations.json or test overrides (_TEST_ALLOWED_TOOLS)."
            )
        logger.warning(
            "Persona missing allowed_tools configuration; defaulting to memory_search only (memory_fallback mode)",
            extra={"persona": persona, "project": project, "persona_allowlist_mode": mode},
        )
        normalized_allowed = ["memory_search"]

    allowed_set = {name.strip().lower() for name in normalized_allowed}
    filtered: list[Any] = []
    dropped: list[str] = []
    allowed_registry: dict[str, Any] = {}

    for name, tool in registry.items():
        if not tool:
            continue
        tool_name = getattr(tool, "name", "").lower()
        if tool_name in allowed_set:
            filtered.append(tool)
            allowed_registry[name] = tool
        else:
            dropped.append(name)

    if dropped:
        logger.warning(
            "Persona tools filtered by allowlist",
            extra={
                "persona": persona,
                "project": project,
                "dropped_tools": sorted(dropped),
                "persona_allowlist_mode": mode,
            },
        )

        if not filtered:
            if fail_fast:
                persona_allowlist_failures_total.labels(
                    persona=str(persona).lower(),
                    project=str(project),
                    mode=mode,
                ).inc()
                raise RuntimeError(
                    f"No tools available for persona '{persona}' after applying allowlist (mode={mode})."
                )
            memory_tool = registry.get("memory_search")
            if memory_tool is None:
                raise RuntimeError(
                    f"Persona '{persona}' allowlist produced no tools and memory_search is unavailable in registry"
                )
            logger.warning(
                "Persona allowlist produced no tools; injecting memory_search (memory_fallback mode)",
                extra={"persona": persona, "project": project, "persona_allowlist_mode": mode},
            )
            filtered = [memory_tool]
            allowed_registry["memory_search"] = memory_tool

    return filtered, allowed_registry


def create_persona_node(persona: str, project: str) -> Any:
    """Create a LangGraph node function for a specific persona.
    
    Returns a function that takes RunState and returns RunState updates.
    """
    def persona_node(state: RunState) -> RunState:
        """Execute persona agent step.

        This function also emits LangSmith child runs (best-effort) under the
        Brendan graph run so you can watch persona progression in real time.
        """
        project_spec = resolve_project_spec_for_state(state, project)
        context = build_persona_context(state, project_spec, persona)
        allowed_tool_names = list(context.get("allowed_tools") or [])
        test_override = _TEST_ALLOWED_TOOLS.get(persona)
        if test_override is not None:
            allowed_tool_names = list(test_override)
        system_prompt = _compose_system_prompt(persona, context)
        try:
            _TEST_CONTEXT_CALLS.append((dict(state), dict(project_spec), persona))
        except Exception:  # pragma: no cover - test-only hook
            pass
        state["context_package"] = context

        optional_state = handle_optional_persona(persona, state)

        # Start a LangSmith child run for this persona step (if a root run exists)
        # We stash the root RunTree on state under "_langsmith_run" if present.
        parent_run = state.get("_langsmith_run")
        ls_child = start_langsmith_child_run(
            parent_run,
            name=f"{project}:{persona}",
            run_type="chain",
            inputs={
                "run_id": state.get("run_id"),
                "project": project,
                "persona": persona,
                "context": context,
            },
            tags=[f"persona:{persona}", f"project:{project}"],
            metadata={
                "run_id": state.get("run_id"),
                "project": project,
                "persona": persona,
            },
        )

        if optional_state is not None:
            end_langsmith_child_run(
                ls_child,
                outputs={"status": "skipped_optional", "persona": persona, "project": project},
            )
            return optional_state

        project_supported = project in _LANGCHAIN_PERSONA_PROJECTS
        feature_enabled = bool(settings.enable_langchain_personas)
        if not LANGCHAIN_AVAILABLE:
            reason_text = "langchain_unavailable"
            end_langsmith_child_run(
                ls_child,
                outputs={
                    "status": "failed_config",
                    "persona": persona,
                    "project": project,
                    "reason": reason_text,
                },
            )
            raise RuntimeError(
                f"LangChain persona execution disabled for {project}:{persona} ({reason_text})."
            )

        use_langchain_persona = feature_enabled and project_supported

        observation = observe_run_progress(
            persona=persona,
            project=project,
            state=state,
            fetch_snapshot=_get_run_snapshot,
        )
        structured_state: RunState = cast(RunState, dict(state))
        structured_state.update(observation.updates)
        structured_state.update(observation.flags)
        base_transcript = list(structured_state.get("transcript") or state.get("transcript", []))
        base_history = list(structured_state.get("persona_history") or state.get("persona_history", []))

        tools, _tool_registry = _register_persona_tools(state, persona, project, allowed_tool_names)

        extra_updates: dict[str, Any] = {}
        langchain_succeeded = False
        if use_langchain_persona:
            try:
                initial_retrieval_count = len(state.get("retrieval_traces") or [])
                initial_retrieval_artifacts = count_artifacts_of_type(state, "retrieval.trace")
                llm = ChatOpenAI(model="gpt-5-nano", temperature=0.2)
                agent_graph: Any = create_agent(model=llm, tools=tools, system_prompt=system_prompt)
                user_input = _build_persona_user_message(persona, context, structured_state)
                result = agent_graph.invoke({"messages": [{"role": "user", "content": user_input}]})
                result_messages = result.get("messages", [])
                _validate_persona_contract(
                    persona=persona,
                    project=project,
                    allowed_tools=allowed_tool_names,
                    result_messages=result_messages,
                    run_id=str(state.get("run_id") or ""),
                )
                if result_messages:
                    last_message = result_messages[-1]
                    if hasattr(last_message, "content"):
                        output_text = getattr(last_message, "content")
                    elif isinstance(last_message, Mapping):
                        output_text = str(last_message.get("content") or last_message)
                    else:
                        output_text = str(last_message)
                else:
                    output_text = f"{persona} processed step."
                final_retrieval_count = len(state.get("retrieval_traces") or [])
                final_retrieval_artifacts = count_artifacts_of_type(state, "retrieval.trace")
                if final_retrieval_count <= initial_retrieval_count:
                    logger.info(
                        "Persona completed without additional memory searches",
                        extra={
                            "persona": persona,
                            "project": project,
                            "run_id": state.get("run_id"),
                            "retrieval_count": final_retrieval_count,
                        },
                    )
                if final_retrieval_artifacts <= initial_retrieval_artifacts:
                    logger.info(
                        "Persona completed without new retrieval artifacts",
                        extra={
                            "persona": persona,
                            "project": project,
                            "run_id": state.get("run_id"),
                            "artifact_count": final_retrieval_artifacts,
                        },
                    )
                langchain_succeeded = True
            except Exception as exc:
                logger.warning(
                    "LangChain persona execution failed; using deterministic fallback",
                    exc_info=exc,
                    extra={"persona": persona, "project": project},
                )
        if not langchain_succeeded:
            logger.info(
                "Using deterministic mock persona execution",
                extra={"persona": persona, "project": project, "providers_mode": settings.providers_mode},
            )
            output_text, extra_updates = run_mock_persona(persona, project, project_spec, structured_state)

        transcript = list(base_transcript)
        transcript.append(output_text)

        persona_history = list(base_history)
        persona_history.append({
            "persona": persona,
            "message": output_text,
        })

        result_state = {
            **structured_state,
            **extra_updates,
            "current_persona": persona,
            "transcript": transcript,
            "persona_history": persona_history,
            "retrieval_traces": state.get("retrieval_traces", []),
            "citations": state.get("citations", []),
            "artifacts": state.get("artifacts", structured_state.get("artifacts", [])),
        }
        end_langsmith_child_run(
            ls_child,
            outputs={
                "status": "completed",
                "persona": persona,
                "project": project,
                "output_text": output_text,
            },
        )
        return result_state
    
    return persona_node
