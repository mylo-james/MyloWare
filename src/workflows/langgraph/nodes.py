"""LangGraph workflow nodes.

Each node implements a step in the video production workflow.
Nodes use Llama Stack agents and return state updates.
"""

from __future__ import annotations

import json
import re
from contextlib import asynccontextmanager, contextmanager
from typing import Any, AsyncGenerator, Generator, Mapping, Optional
from uuid import UUID

from langgraph.types import interrupt, RunnableConfig

import anyio

from agents.factory import create_agent
from llama_clients import get_async_client, get_sync_client
from config import settings
from observability.logging import get_logger
from storage.database import get_async_session_factory  # get_session used in tests
from storage.models import ArtifactType, RunStatus
from storage.repositories import ArtifactRepository, RunRepository
from workflows.extractors import get_extractor
from workflows.helpers import extract_trace_id
from workflows.langgraph.state import VideoWorkflowState
from workflows.parsers import parse_structured_ideation
from workflows.langgraph.safety_cache import guard_input_with_cache, guard_output_with_cache
from workflows.langgraph.utils import sorted_video_clip_artifacts

# Expose safety helpers for monkeypatching in tests (backwards compatibility)
check_agent_input = guard_input_with_cache
check_agent_output = guard_output_with_cache

logger = get_logger(__name__)


@contextmanager
def agent_session(client: Any, agent: Any, session_name: str) -> Generator[str, None, None]:
    """Context manager for agent sessions with automatic cleanup."""
    session_id = agent.create_session(session_name)
    try:
        yield session_id
    finally:
        try:
            client.conversations.delete(conversation_id=session_id)
            logger.debug("Cleaned up session: %s", session_id)
        except Exception as exc:
            logger.warning("Failed to cleanup session %s: %s", session_id, exc)


def extract_content(response: Any) -> str:
    """Extract primary text from Llama Stack responses (agent or chat completions)."""
    if response is None:
        return ""
    output_text = getattr(response, "output_text", None)
    if output_text:
        return str(output_text)
    choices = getattr(response, "choices", None)
    if choices:
        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", None) if message else None
        if content:
            return str(content)
    content = getattr(response, "content", None)
    return str(content) if content else ""


def _strip_noise_for_safety(text: str) -> str:
    """Remove non-semantic orchestration noise before running safety shields.

    Shields should run only on meaningful human/creative content. Tool receipts,
    IDs, URLs, and UUIDs are treated as noise and can cause false positives.
    """
    if not text:
        return ""

    sanitized = text
    # Sora task IDs like video_693bcfa...
    sanitized = re.sub(r"\bvideo_[A-Za-z0-9_-]{8,}\b", "<video_task_id>", sanitized)
    # Remotion job IDs / other opaque ids
    sanitized = re.sub(r"\bfake-render-[A-Za-z0-9_-]+\b", "<render_job_id>", sanitized)
    sanitized = re.sub(r"\bjob_[A-Za-z0-9_-]{6,}\b", "<render_job_id>", sanitized)
    # UUIDs
    sanitized = re.sub(
        r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
        "<uuid>",
        sanitized,
    )
    # URLs
    sanitized = re.sub(r"https?://\S+", "<url>", sanitized)
    return sanitized.strip()


async def _maybe_store_safety_cache(
    state: dict[str, Any], artifact_repo: ArtifactRepository, run_id: UUID
) -> None:
    """Persist safety cache as a run artifact for UI visibility."""
    cache = state.get("safety_cache") or {}
    if not cache:
        return
    try:
        await artifact_repo.create_async(
            run_id=run_id,
            persona="safety",
            artifact_type=ArtifactType.SAFETY_VERDICT,
            content=json.dumps(cache),
            metadata={"type": "safety_cache", "entries": len(cache)},
        )
    except Exception as exc:  # don't fail workflow on telemetry artifact
        logger.warning("Failed to store safety cache artifact: %s", exc)


class SimpleMessage:
    """Minimal message wrapper exposing .content for tool parsing."""

    def __init__(self, content: str):
        self.content = content


def _tool_response_contents(response: Any, tool_name: str) -> list[Any]:
    """Collect tool response contents for a given tool name across common Llama Stack shapes.

    We keep this tolerant to SDK drift while still failing fast if no evidence exists.
    """

    contents: list[Any] = []

    def _maybe_add(tool_response: Any) -> None:
        if tool_response is None:
            return
        name = getattr(tool_response, "tool_name", None) or getattr(tool_response, "name", None)
        if name is None and isinstance(tool_response, dict):
            name = tool_response.get("tool_name") or tool_response.get("name")
        if name != tool_name:
            return
        content = (
            getattr(tool_response, "content", None)
            if hasattr(tool_response, "content")
            else tool_response.get("content")
            if isinstance(tool_response, dict)
            else None
        )
        if content is not None:
            contents.append(content)

    steps = getattr(response, "steps", None) or []
    for step in steps:
        if getattr(step, "step_type", None) != "tool_execution":
            continue
        result_obj = getattr(step, "result", None)
        tool_responses = []
        if result_obj and hasattr(result_obj, "tool_responses"):
            tool_responses = getattr(result_obj, "tool_responses") or []
        elif hasattr(step, "tool_responses"):
            tool_responses = getattr(step, "tool_responses") or []
        for tr in tool_responses:
            _maybe_add(tr)

    # Some SDK shapes attach tool_responses at the top-level result.
    for container in (getattr(response, "result", None), response):
        if not container:
            continue
        trs = getattr(container, "tool_responses", None)
        if trs:
            for tr in trs:
                _maybe_add(tr)

    return contents


def _create_turn_collecting_tool_responses(
    agent: Any, messages: list[dict[str, Any]], session_id: str
) -> tuple[Any, list[dict[str, Any]]]:
    """Run a sync Agent turn in streaming mode and collect tool responses.

    llama_stack_client Agent.create_turn(stream=False) iterates the stream internally
    but only returns the final response object, discarding StepCompleted(tool_execution)
    events that contain client-side tool responses. For fail-fast orchestration, we
    need those tool outputs (task_ids, job_id, published_url) explicitly.
    """

    stream = agent.create_turn(messages, session_id, stream=True)
    final_response = None
    tool_responses: list[dict[str, Any]] = []

    for chunk in stream:
        event = getattr(chunk, "event", None)
        if getattr(event, "step_type", None) == "tool_execution":
            result = getattr(event, "result", None)
            responses = getattr(result, "tool_responses", None) or []
            for tr in responses:
                if isinstance(tr, dict):
                    tool_responses.append(tr)
                else:
                    tool_responses.append(
                        {
                            "call_id": getattr(tr, "call_id", None),
                            "tool_name": getattr(tr, "tool_name", None),
                            "content": getattr(tr, "content", None),
                            "metadata": getattr(tr, "metadata", None),
                        }
                    )

        response = getattr(chunk, "response", None)
        if response is not None:
            final_response = response

    if final_response is None:
        raise Exception("Turn did not complete")

    return final_response, tool_responses


def _tool_response_contents_from_payloads(
    tool_responses: list[dict[str, Any]], tool_name: str
) -> list[Any]:
    contents: list[Any] = []
    for payload in tool_responses:
        if payload.get("tool_name") != tool_name:
            continue
        if "content" in payload:
            contents.append(payload.get("content"))
    return contents


def _run_guard(client: Any, content: str | None = None) -> None:
    """Run output safety guard when external services are enabled.

    In production we call the client's safety shield; in tests we no-op to keep
    unit tests isolated.
    """
    if settings.disable_background_workflows or settings.llama_stack_provider != "real":
        return
    # Minimal guard hook used by tests; real shielding happens in step code
    if hasattr(client, "safety") and hasattr(client.safety, "run_shield"):
        client.safety.run_shield(content=content or "")


@asynccontextmanager
async def _get_repositories_async(
    run_id: str,
) -> AsyncGenerator[tuple[ArtifactRepository, RunRepository], None]:
    """Get async repositories for a run with proper session management.

    Returns a context manager that yields (run_repo, artifact_repo, session).
    The session is automatically closed when exiting the context.

    Usage:
        async with _get_repositories_async(run_id) as (run_repo, artifact_repo, session):
            # Use repositories
            await run_repo.update_async(...)
            await session.commit()
    """

    SessionLocal = get_async_session_factory()
    session = SessionLocal()
    try:
        run_repo = RunRepository(session)
        artifact_repo = ArtifactRepository(session)
        yield run_repo, artifact_repo, session
    finally:
        # Ensure session is always closed
        await session.close()


async def ideation_node(
    state: VideoWorkflowState, config: Optional[RunnableConfig] = None
) -> dict[str, Any]:
    """Generate creative ideas from brief using ideator agent."""
    run_id_value = state.get("run_id")
    if not run_id_value and config:
        if isinstance(config, Mapping):
            configurable = config.get("configurable")
            if isinstance(configurable, Mapping):
                run_id_value = configurable.get("thread_id")
    if not run_id_value:
        raise ValueError("run_id missing in workflow state and config")

    logger.info("Ideation node started for run %s", run_id_value)

    run_id = UUID(str(run_id_value))
    # Normalize run_id back into state for downstream nodes
    state["run_id"] = str(run_id)
    # Use sync Agent in a background thread to avoid blocking the event loop
    client = get_sync_client()
    async_client = get_async_client()

    # Use async session with proper cleanup
    async with _get_repositories_async(state["run_id"]) as (run_repo, artifact_repo, session):
        try:
            # Get run with retry to handle transaction isolation (especially SQLite)
            import asyncio

            run = None
            for attempt in range(3):
                run = await run_repo.get_async(state["run_id"])
                if run is not None:
                    break
                if attempt < 2:
                    await asyncio.sleep(0.1 * (attempt + 1))  # Small delay with backoff

            if run is None:
                logger.error("Run %s not found after retries in ideation_node", state["run_id"])
                return {
                    "error": f"Run {state['run_id']} not found",
                    "status": RunStatus.FAILED.value,
                }

            # Create ideator agent (sync Agent) but execute calls via to_thread
            ideator = create_agent(
                client,
                state["project"],
                "ideator",
                state.get("vector_db_id"),
            )

            # Guard-first pattern: check input safety before inference (replay-aware cache)
            input_messages = [{"role": "user", "content": f"Brief:\n{state['brief']}"}]
            input_safety = await check_agent_input(
                state, async_client, "ideation_input", input_messages
            )
            if not getattr(input_safety, "safe", False):
                logger.warning("Ideation input blocked by safety: %s", input_safety.reason)
                return {
                    "error": f"Input safety check failed: {input_safety.reason}",
                    "status": RunStatus.FAILED.value,
                }

            # Generate ideas (guard → inference)
            with agent_session(client, ideator, f"run-{run_id}-ideator") as session_id:
                response = await anyio.to_thread.run_sync(
                    ideator.create_turn,
                    input_messages,
                    session_id,
                )

                ideas = extract_content(response)

            # Check output safety (inference → guard) with caching for replay/time-travel
            safety_result = await check_agent_output(
                state, async_client, "ideation_output", ideas
            )
            if not getattr(safety_result, "safe", False):
                logger.warning("Ideation output blocked by safety: %s", safety_result.reason)
                return {
                    "error": f"Safety check failed: {safety_result.reason}",
                    "status": RunStatus.FAILED.value,
                }

            # Parse structured ideation
            structured = parse_structured_ideation(ideas)

            # Store artifacts (use async methods)
            await artifact_repo.create_async(
                run_id=run_id,
                persona="ideator",
                artifact_type=ArtifactType.IDEAS,
                content=ideas,
                metadata={"step": "ideator"},
                trace_id=extract_trace_id(response),
            )
            await run_repo.add_artifact_async(run_id, "ideas", ideas)

            if structured:
                await artifact_repo.create_async(
                    run_id=run_id,
                    persona="ideator",
                    artifact_type=ArtifactType.IDEAS_STRUCTURED,
                    content=json.dumps(structured),
                    metadata={"step": "ideator", "topic": structured.get("topic")},
                )
                await run_repo.add_artifact_async(run_id, "ideas_structured", structured)

            # Store safety cache for UI visibility
            await _maybe_store_safety_cache(state, artifact_repo, run_id)

            # Extract overlays using project's extractor
            overlays = None
            try:
                from config.projects import load_project

                project_config = load_project(state["project"])
                extractor_name = project_config.overlay_extractor
                if extractor_name:
                    extractor = get_extractor(extractor_name)
                    if extractor:
                        overlays = extractor(ideas, structured)
                        if overlays:
                            await run_repo.add_artifact_async(run_id, "overlays", overlays)
            except Exception as e:
                logger.warning("Failed to extract overlays: %s", e)

            # Persist status/current_step in the run record so HITL gate can be reached
            try:
                await run_repo.update_async(
                    run_id,
                    status=RunStatus.AWAITING_IDEATION_APPROVAL.value,
                    current_step="ideation",
                )
            except Exception as status_exc:
                logger.warning(
                    "Failed to update run status after ideation for %s: %s", run_id, status_exc
                )

            await session.commit()

            logger.info("Ideation complete for run %s", run_id)

            return {
                "ideas": ideas,
                "ideas_structured": structured,
                "overlays": overlays,
                "current_step": "ideation",
                "status": RunStatus.AWAITING_IDEATION_APPROVAL.value,
            }

        except Exception as exc:
            logger.exception("Ideation node failed: %s", exc)
            await session.rollback()
            raise


def ideation_approval_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Human-in-the-loop approval for ideation."""
    logger.info("Ideation approval node for run %s", state.get("run_id"))

    # Interrupt and wait for human approval
    approval = interrupt(
        {
            "task": "Review and approve video ideas",
            "run_id": state["run_id"],
            "ideas": state.get("ideas"),
            "ideas_structured": state.get("ideas_structured"),
        }
    )

    approved = approval.get("approved", False) if isinstance(approval, dict) else False
    comment = approval.get("comment") if isinstance(approval, dict) else None

    if approved:
        logger.info("Ideation approved for run %s", state.get("run_id"))
        return {
            "ideas_approved": True,
            "approval_comment": comment,
            "current_step": "production",
        }
    else:
        logger.info("Ideation rejected for run %s: %s", state.get("run_id"), comment)
        return {
            "ideas_approved": False,
            "approval_comment": comment,
            "status": RunStatus.REJECTED.value,
        }


async def production_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Generate video clips using producer agent and OpenAI Sora."""
    logger.info("Production node started for run %s", state.get("run_id"))

    if not state.get("ideas_approved"):
        return {
            "error": "Ideation not approved",
            "status": RunStatus.REJECTED.value,
        }

    run_id = UUID(state["run_id"])
    client = get_sync_client()
    async_client = get_async_client()

    # Use async session with proper cleanup
    async with _get_repositories_async(state["run_id"]) as (run_repo, artifact_repo, session):
        try:
            # Create producer agent
            producer = create_agent(
                client,
                state["project"],
                "producer",
                state.get("vector_db_id"),
                run_id=str(run_id),
            )

            # Get ideas from artifacts (use async method with retry for transaction isolation)
            import asyncio

            run = None
            for attempt in range(3):
                run = await run_repo.get_async(run_id)
                if run is not None:
                    break
                if attempt < 2:
                    await asyncio.sleep(0.1 * (attempt + 1))
            if not run:
                logger.error("Run %s not found after retries in production_node", run_id)
                return {"error": f"Run {run_id} not found", "status": RunStatus.FAILED.value}

            ideas_text = (run.artifacts or {}).get("ideas", "")
            if not ideas_text:
                return {"error": "No ideas found", "status": RunStatus.FAILED.value}

            # Guard-first: check input safety (cacheable)
            input_messages = [{"role": "user", "content": f"Ideas:\n{ideas_text}"}]
            input_safety = await check_agent_input(
                state, async_client, "production_input", input_messages
            )
            if not getattr(input_safety, "safe", False):
                logger.warning("Production input blocked by safety: %s", input_safety.reason)
                return {
                    "error": f"Input safety check failed: {input_safety.reason}",
                    "status": RunStatus.FAILED.value,
                }

            # Test mode: return fake URLs immediately for replayability.
            # Important: do this before streaming tool collection because the fake
            # Agent implementation does not support stream=True iteration.
            if settings.disable_background_workflows or settings.llama_stack_provider != "real":
                producer_output = f"Fake producer output for run {run_id}"

                await artifact_repo.create_async(
                    run_id=run_id,
                    persona="producer",
                    artifact_type=ArtifactType.PRODUCER_OUTPUT,
                    content=producer_output,
                    metadata={"step": "producer", "fake": True},
                )

                video_count = 2
                fake_video_urls = [
                    f"https://fake.sora.openai/video{i}.mp4" for i in range(video_count)
                ]

                logger.info(
                    "Test mode: returning %d fake video URLs immediately for run %s",
                    len(fake_video_urls),
                    run_id,
                )

                for idx, url in enumerate(fake_video_urls):
                    await artifact_repo.create_async(
                        run_id=run_id,
                        persona="producer",
                        artifact_type=ArtifactType.VIDEO_CLIP,
                        uri=url,
                        metadata={"step": "production", "video_index": idx, "fake": True},
                    )

                await session.commit()

                return {
                    "video_clips": fake_video_urls,
                    "production_complete": True,
                    "current_step": "editing",
                }

            # Call producer agent to generate videos (guard → inference)
            tool_response_payloads: list[dict[str, Any]] = []
            with agent_session(client, producer, f"run-{run_id}-producer") as session_id:
                response, tool_response_payloads = await anyio.to_thread.run_sync(
                    _create_turn_collecting_tool_responses,
                    producer,
                    input_messages,
                    session_id,
                )

                producer_output = extract_content(response)

                # Debug: Log what we extracted
                logger.info(
                    "Extracted producer output: %d chars, preview: %s",
                    len(producer_output) if producer_output else 0,
                    producer_output[:200] if producer_output else "None",
                )

                logger.info(
                    "Collected %d tool responses from producer turn",
                    len(tool_response_payloads),
                )

            # Check output safety only on semantic content (strip tool receipts/IDs).
            sanitized_output = _strip_noise_for_safety(producer_output)
            if sanitized_output:
                safety_result = await check_agent_output(
                    state, async_client, "production_output", sanitized_output
                )
                if not getattr(safety_result, "safe", False):
                    logger.warning(
                        "Production output blocked by safety: %s", safety_result.reason
                    )
                    return {
                        "error": f"Safety check failed: {safety_result.reason}",
                        "status": RunStatus.FAILED.value,
                    }

            # Store producer output (use async method)
            await artifact_repo.create_async(
                run_id=run_id,
                persona="producer",
                artifact_type=ArtifactType.PRODUCER_OUTPUT,
                content=producer_output,
                metadata={"step": "producer"},
            )

            # Store safety cache artifact
            await _maybe_store_safety_cache(state, artifact_repo, run_id)

            submitted_task_ids: list[str] = []
            tool_execution_error: str | None = None

            def _parse_tool_response_content(content: Any) -> tuple[list[str], str | None]:
                """Return (task_ids, error_message)."""
                if isinstance(content, str):
                    if content.startswith("Error when running tool:"):
                        return [], content
                    try:
                        parsed = json.loads(content)
                    except Exception:
                        return [], None
                elif isinstance(content, dict):
                    parsed = content
                else:
                    return [], None

                task_ids = parsed.get("data", {}).get("task_ids") or parsed.get("task_ids") or []
                return task_ids or [], None

            # Parse tool response payloads collected from the streaming turn.
            sora_tool_executed = False
            for content in _tool_response_contents_from_payloads(tool_response_payloads, "sora_generate"):
                task_ids, error_msg = _parse_tool_response_content(content)
                sora_tool_executed = True
                if error_msg:
                    tool_execution_error = error_msg
                    continue
                if task_ids:
                    submitted_task_ids.extend(task_ids)
                    break

            # Fallback: if no tool_execution was captured, try to recover task_ids from artifacts
            if not sora_tool_executed:
                try:
                    all_artifacts = await artifact_repo.get_by_run_async(run_id)
                    manifest = next(
                        (
                            a
                            for a in all_artifacts
                            if a.artifact_type == ArtifactType.CLIP_MANIFEST.value
                        ),
                        None,
                    )
                    if manifest and manifest.content:
                        try:
                            manifest_json = json.loads(manifest.content)
                            manifest_task_ids = list((manifest_json or {}).keys())
                        except Exception:
                            manifest_task_ids = []
                        if manifest_task_ids:
                            submitted_task_ids = manifest_task_ids
                            sora_tool_executed = True
                            logger.info(
                                "Recovered %d Sora task_ids from clip_manifest artifact for run %s",
                                len(submitted_task_ids),
                                run_id,
                            )
                except Exception as artifact_exc:  # pragma: no cover - defensive
                    logger.warning(
                        "Failed to recover task_ids from artifacts: %s", artifact_exc, exc_info=True
                    )

            if tool_execution_error:
                logger.error(
                    "Tool execution error detected: %s - failing production node",
                    tool_execution_error,
                )
                return {
                    "error": f"Failed to submit video generation jobs: {tool_execution_error}",
                    "status": RunStatus.FAILED.value,
                }

            if not sora_tool_executed:
                logger.error("Producer did not execute sora_generate tool via Llama Stack")
                logger.error("Producer output: %s", producer_output[:500])
                return {
                    "error": "Producer did not execute sora_generate tool. Check agent instructions and tool configuration.",
                    "status": RunStatus.FAILED.value,
                }

            # Update status and wait for results (webhook)
            await run_repo.update_async(
                run_id,
                status=RunStatus.AWAITING_VIDEO_GENERATION.value,
                current_step="wait_for_videos",
            )
            if submitted_task_ids:
                add_artifact = getattr(run_repo, "add_artifact_async", None)
                if callable(add_artifact):
                    await add_artifact(run_id, "pending_task_ids", submitted_task_ids)
                else:  # pragma: no cover - defensive for stub repositories in unit tests
                    logger.debug(
                        "RunRepository missing add_artifact_async; skipping pending_task_ids record"
                    )
            await session.commit()

            logger.info("Production complete, waiting for videos for run %s", run_id)

            return {
                "pending_task_ids": submitted_task_ids,
                "current_step": "wait_for_videos",
                "status": RunStatus.AWAITING_VIDEO_GENERATION.value,
            }

        except Exception as exc:
            logger.exception("Production node failed: %s", exc)
            await session.rollback()
            return {
                "error": str(exc),
                "status": RunStatus.FAILED.value,
            }


async def wait_for_videos_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Wait for video generation webhooks via interrupt."""
    logger.info("Wait for videos node for run %s", state.get("run_id"))

    # Interrupt and wait for webhook to resume with video URLs
    webhook_data = interrupt(
        {
            "task": "Waiting for video generation",
            "run_id": state["run_id"],
            "waiting_for": "sora_webhook",
        }
    )

    # Extract video URLs from webhook data
    video_urls = []
    if isinstance(webhook_data, dict):
        video_urls = webhook_data.get("video_urls", [])
        if not video_urls:
            # Try alternative key
            video_urls = webhook_data.get("urls", [])

    if not video_urls:
        # Keep waiting instead of failing; webhook will resume again.
        logger.warning(
            "No video URLs in webhook data for run %s; keeping interrupt active",
            state.get("run_id"),
        )
        return interrupt(
            {
                "task": "Waiting for video generation",
                "run_id": state["run_id"],
                "waiting_for": "sora_webhook",
            }
        )

    logger.info("Received %d video URLs for run %s", len(video_urls), state.get("run_id"))

    return {
        "video_clips": video_urls,
        "production_complete": True,
        "current_step": "editing",
        "status": RunStatus.RUNNING.value,
        "error": None,
    }


async def editing_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Compose video clips into final video using editor agent and Remotion."""
    logger.info("Editing node started for run %s", state.get("run_id"))

    if not state.get("video_clips"):
        return {
            "error": "No video clips available",
            "status": RunStatus.FAILED.value,
        }

    run_id = UUID(state["run_id"])
    client = get_sync_client()
    async_client = get_async_client()

    # Use async session with proper cleanup
    async with _get_repositories_async(state["run_id"]) as (run_repo, artifact_repo, session):
        try:
            # Get video clips from artifacts (use async method)
            all_artifacts = await artifact_repo.get_by_run_async(run_id)
            video_clips = sorted_video_clip_artifacts(all_artifacts)

            if not video_clips:
                return {
                    "error": "No video clips found in artifacts",
                    "status": RunStatus.FAILED.value,
                }

            # Create editor agent
            editor = create_agent(
                client,
                state["project"],
                "editor",
                state.get("vector_db_id"),
                run_id=str(run_id),
            )

            # Build clip data
            clips_data = []
            for clip in video_clips:
                metadata = clip.artifact_metadata or {}
                clips_data.append(
                    {
                        "url": clip.uri or "",
                        "object_name": metadata.get("object_name"),
                        "sign": metadata.get("sign"),
                        "topic": metadata.get("topic"),
                    }
                )

            clip_urls = [c["url"] for c in clips_data if c["url"]]

            # Build editor prompt (same as EditingStep)
            from config.projects import load_project

            project_config = load_project(state["project"])
            # specs is a Pydantic model, access attributes directly
            duration_seconds = (
                getattr(project_config.specs, "compilation_length", 30)
                if hasattr(project_config, "specs")
                else 30
            )

            # Get run with retry for transaction isolation
            import asyncio

            run = None
            for attempt in range(3):
                run = await run_repo.get_async(run_id)
                if run is not None:
                    break
                if attempt < 2:
                    await asyncio.sleep(0.1 * (attempt + 1))
            artifacts = run.artifacts or {} if run else {}
            creative_direction = artifacts.get("ideas") or artifacts.get("script") or ""
            overlays = artifacts.get("overlays", [])

            if state["project"] == "aismr":
                objects_from_overlays = [o.get("text", o.get("identifier", "")) for o in overlays]
                editor_prompt = (
                    f"Render a zodiac ASMR video with the 'aismr' template.\n\n"
                    f"## CLIPS (use these EXACT URLs):\n{json.dumps(clip_urls, indent=2)}\n\n"
                    f"## OBJECTS (use these EXACT names - NOT zodiac signs!):\n{json.dumps(objects_from_overlays, indent=2)}\n\n"
                    f"CRITICAL: Call remotion_render tool with:\n"
                    f"- template: 'aismr'\n"
                    f"- clips: {json.dumps(clip_urls)}\n"
                    f"- objects: {json.dumps(objects_from_overlays)}\n"
                    f"- duration_seconds: {duration_seconds}\n"
                    f"- fps: 30\n"
                    f"- aspect_ratio: '9:16'\n\n"
                    f"DO NOT just output code - you MUST call the remotion_render tool!"
                )
            elif state["project"] == "test_video_gen":
                texts = [o.get("text", f"TEXT {i+1}") for i, o in enumerate(overlays)]
                while len(texts) < 4:
                    texts.append(f"TEXT {len(texts) + 1}")
                editor_prompt = (
                    f"Render a motivational video with the 'motivational' template.\n\n"
                    f"## CLIPS (use these EXACT URLs):\n{json.dumps(clip_urls, indent=2)}\n\n"
                    f"## TEXT OVERLAYS (use these EXACT texts):\n{json.dumps(texts[:4], indent=2)}\n\n"
                    f"CRITICAL: Call remotion_render tool with:\n"
                    f"- template: 'motivational'\n"
                    f"- clips: {json.dumps(clip_urls)}\n"
                    f"- texts: {json.dumps(texts[:4])}\n"
                    f"- duration_seconds: 16\n"
                    f"- fps: 30\n"
                    f"- aspect_ratio: '9:16'\n\n"
                    f"DO NOT just output code - you MUST call the remotion_render tool!"
                )
            else:
                editor_prompt = (
                    f"You have {len(clip_urls)} video clips to compose:\n"
                    f"{json.dumps(clip_urls, indent=2)}\n\n"
                    f"Creative direction/ideation:\n{creative_direction}\n\n"
                    f"WORKFLOW (recommended):\n"
                    f"1. **Analyze clips first** (optional but recommended):\n"
                    f"   - Use `analyze_media` tool on each clip to understand content, colors, composition\n"
                    f"   - Extract color palettes and composition details\n"
                    f"   - Get transition and pacing recommendations\n"
                    f"2. **Make informed creative decisions**:\n"
                    f"   - Choose transitions based on clip content (soft dissolve for calm, cuts for energetic)\n"
                    f"   - Match pacing to content type\n"
                    f"   - Apply extracted colors to text overlays and styling\n"
                    f"3. **Create composition**:\n"
                    f"   - Use templates (aismr, motivational) OR write custom TSX code\n"
                    f"   - Query knowledge base for Remotion API, components, animations\n"
                    f"   - Apply your creative choices\n"
                    f"   - Call remotion_render tool with:\n"
                    f"     - composition_code: your TSX (NO import statements) OR template: 'template_name'\n"
                    f"     - clips: the video URLs array above\n"
                    f"     - duration_seconds: {duration_seconds}\n"
                    f"     - fps: 30\n"
                    f"     - aspect_ratio: '9:16'\n\n"
                    f"You have creative freedom - use templates or custom code as you see fit!\n"
                    f"DO NOT just output code - you MUST call the remotion_render tool!"
                )

            # Guard-first: check input safety (replay-aware caching)
            input_messages = [{"role": "user", "content": editor_prompt}]
            sanitized_prompt = _strip_noise_for_safety(editor_prompt)
            safety_messages = (
                [{"role": "user", "content": sanitized_prompt}]
                if sanitized_prompt
                else input_messages
            )
            input_safety = await check_agent_input(
                state, async_client, "editing_input", safety_messages
            )
            if not getattr(input_safety, "safe", False):
                logger.warning("Editing input blocked by safety: %s", input_safety.reason)
                return {
                    "error": f"Input safety check failed: {input_safety.reason}",
                    "status": RunStatus.FAILED.value,
                }

            # Test mode (or Llama Stack disabled): skip tool execution and return fake output immediately
            if settings.disable_background_workflows or settings.llama_stack_provider != "real":
                render_job_id = f"fake-render-{run_id}"
                editor_output = f"Fake editor output for run {run_id}"

                # Store editor output (use async method)
                await artifact_repo.create_async(
                    run_id=run_id,
                    persona="editor",
                    artifact_type=ArtifactType.EDITOR_OUTPUT,
                    content=editor_output,
                    metadata={
                        "step": "editor",
                        "clip_count": len(clip_urls),
                        "render_job_id": render_job_id,
                        "fake": True,
                    },
                )
                # Generate deterministic fake final video URL
                fake_final_url = f"https://fake.remotion.com/{run_id}/final.mp4"

                logger.info(
                    "Fake provider mode: returning fake final video URL immediately for run %s",
                    run_id,
                )

                # Store fake final video as artifact (use async method)
                await artifact_repo.create_async(
                    run_id=run_id,
                    persona="editor",
                    artifact_type=ArtifactType.RENDERED_VIDEO,
                    uri=fake_final_url,
                    metadata={"step": "editing", "fake": True, "render_job_id": render_job_id},
                )

                # Don't update status - workflow will continue automatically
                await session.commit()

                return {
                    "final_video_url": fake_final_url,
                    "current_step": "publish_approval",
                }

            # Real mode: call editor agent - tools are executed automatically by Llama Stack
            render_job_id = None
            tool_response_payloads: list[dict[str, Any]] = []
            with agent_session(client, editor, f"run-{run_id}-editor") as session_id:
                response, tool_response_payloads = await anyio.to_thread.run_sync(
                    _create_turn_collecting_tool_responses,
                    editor,
                    input_messages,
                    session_id,
                )

                editor_output = extract_content(response)

                logger.info(
                    "Collected %d tool responses from editor turn",
                    len(tool_response_payloads),
                )

                for content in _tool_response_contents_from_payloads(
                    tool_response_payloads, "remotion_render"
                ):
                    if isinstance(content, dict):
                        render_job_id = content.get("data", {}).get("job_id") or content.get(
                            "job_id"
                        )
                    elif isinstance(content, str):
                        try:
                            parsed = json.loads(content)
                            render_job_id = parsed.get("data", {}).get("job_id") or parsed.get(
                                "job_id"
                            )
                        except Exception:
                            render_job_id = None
                    if render_job_id:
                        logger.info("Remotion render job submitted: %s", render_job_id)
                        break

                if not render_job_id:
                    logger.error("Editor did not execute remotion_render tool via Llama Stack")
                    return {
                        "error": "Editor did not execute remotion_render tool. Check agent instructions and tool configuration.",
                        "status": RunStatus.FAILED.value,
                    }

            # Check output safety only on semantic content (strip tool receipts/IDs).
            sanitized_editor_output = _strip_noise_for_safety(editor_output)
            if sanitized_editor_output:
                safety_result = await check_agent_output(
                    state, async_client, "editing_output", sanitized_editor_output
                )
                if not getattr(safety_result, "safe", False):
                    logger.warning(
                        "Editing output blocked by safety: %s", safety_result.reason
                    )
                    return {
                        "error": f"Safety check failed: {safety_result.reason}",
                        "status": RunStatus.FAILED.value,
                    }

            # Store editor output and job_id (use async method)
            await artifact_repo.create_async(
                run_id=run_id,
                persona="editor",
                artifact_type=ArtifactType.EDITOR_OUTPUT,
                content=editor_output,
                metadata={
                    "step": "editor",
                    "clip_count": len(clip_urls),
                    "render_job_id": render_job_id,
                },
            )

            # Store safety cache artifact
            await _maybe_store_safety_cache(state, artifact_repo, run_id)

            if settings.remotion_provider == "fake":
                render_job_id = render_job_id or f"fake-render-{run_id}"
                fake_final_url = f"https://fake.remotion.com/{run_id}/final.mp4"

                await artifact_repo.create_async(
                    run_id=run_id,
                    persona="editor",
                    artifact_type=ArtifactType.RENDERED_VIDEO,
                    uri=fake_final_url,
                    metadata={
                        "step": "editing",
                        "fake": True,
                        "render_job_id": render_job_id,
                        "source": "remotion_fake",
                    },
                )
                await run_repo.update_async(
                    run_id,
                    status=RunStatus.AWAITING_PUBLISH_APPROVAL.value,
                    current_step="publish_approval",
                )
                await session.commit()

                logger.info(
                    "Remotion provider fake: skipping render webhook and continuing (run=%s, url=%s)",
                    run_id,
                    fake_final_url,
                )
                return {
                    "final_video_url": fake_final_url,
                    "current_step": "publish_approval",
                    "status": RunStatus.AWAITING_PUBLISH_APPROVAL.value,
                }

            # Real mode: submit render job and wait for webhook
            await run_repo.update_async(run_id, status=RunStatus.AWAITING_RENDER.value)
            await session.commit()

            logger.info(
                "Editing complete, render job %s submitted, waiting for webhook for run %s",
                render_job_id,
                run_id,
            )

            return {
                "render_job_id": render_job_id,
                "current_step": "wait_for_render",
                "status": RunStatus.AWAITING_RENDER.value,
            }

        except Exception as exc:
            logger.exception("Editing node failed: %s", exc)
            await session.rollback()
            return {
                "error": str(exc),
                "status": RunStatus.FAILED.value,
            }


async def wait_for_render_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Wait for Remotion render webhook via interrupt."""
    logger.info("Wait for render node for run %s", state.get("run_id"))

    # Interrupt and wait for webhook to resume with video URL
    webhook_data = interrupt(
        {
            "task": "Waiting for video render",
            "run_id": state["run_id"],
            "waiting_for": "remotion_webhook",
        }
    )

    # Extract video URL from webhook data
    video_url = None
    if isinstance(webhook_data, dict):
        video_url = webhook_data.get("video_url") or webhook_data.get("output_url")

    if not video_url:
        logger.warning(
            "No video URL in webhook data for run %s; keeping interrupt active",
            state.get("run_id"),
        )
        return interrupt(
            {
                "task": "Waiting for video render",
                "run_id": state["run_id"],
                "waiting_for": "remotion_webhook",
            }
        )

    logger.info("Received video URL for run %s: %s", state.get("run_id"), video_url)

    return {
        "final_video_url": video_url,
        "current_step": "publish_approval",
    }


async def publish_approval_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Human-in-the-loop approval for publishing."""
    logger.info("Publish approval node for run %s", state.get("run_id"))

    # Auto-approve in test mode to keep tests fast
    if settings.disable_background_workflows or settings.llama_stack_provider != "real":
        return {
            "publish_approved": True,
            "current_step": "publishing",
        }

    # Interrupt and wait for human approval
    approval = interrupt(
        {
            "task": "Review and approve video for publishing",
            "run_id": state["run_id"],
            "video_url": state.get("final_video_url"),
        }
    )

    approved = approval.get("approved", False) if isinstance(approval, dict) else False
    comment = approval.get("comment") if isinstance(approval, dict) else None

    if approved:
        logger.info("Publish approved for run %s", state.get("run_id"))
        return {
            "publish_approved": True,
            "approval_comment": comment,
            "current_step": "publishing",
        }
    else:
        logger.info("Publish rejected for run %s: %s", state.get("run_id"), comment)
        return {
            "publish_approved": False,
            "approval_comment": comment,
            "status": RunStatus.REJECTED.value,
        }


async def publishing_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Publish video to social platforms using publisher agent."""
    logger.info("Publishing node started for run %s", state.get("run_id"))

    if not state.get("publish_approved"):
        return {
            "error": "Publish not approved",
            "status": RunStatus.REJECTED.value,
        }

    if not state.get("final_video_url"):
        return {
            "error": "No video URL available",
            "status": RunStatus.FAILED.value,
        }

    run_id = UUID(state["run_id"])
    client = get_sync_client()
    async_client = get_async_client()

    # Use async session with proper cleanup
    async with _get_repositories_async(state["run_id"]) as (run_repo, artifact_repo, session):
        try:
            # Create publisher agent
            publisher = create_agent(
                client,
                state["project"],
                "publisher",
                state.get("vector_db_id"),
                run_id=str(run_id),
            )

            # Get video URL and topic (use async method with retry for transaction isolation)
            import asyncio

            run = None
            for attempt in range(3):
                run = await run_repo.get_async(run_id)
                if run is not None:
                    break
                if attempt < 2:
                    await asyncio.sleep(0.1 * (attempt + 1))
            if not run:
                logger.error("Run %s not found after retries in publishing_node", run_id)
                return {"error": f"Run {run_id} not found", "status": RunStatus.FAILED.value}

            video_url = state["final_video_url"]
            artifacts = run.artifacts or {}
            structured = artifacts.get("ideas_structured", {})
            topic = structured.get("topic", "") if isinstance(structured, dict) else ""

            # Test mode (or Llama Stack disabled): skip tool execution and return fake output immediately
            if settings.disable_background_workflows or settings.llama_stack_provider != "real":
                # In fake mode, skip tool execution and return fake published URLs immediately
                publisher_output = f"Fake publisher output for run {run_id}"
                fake_published_url = f"https://tiktok.com/@fake/{run_id}"

                # Store publisher output (use async method)
                await artifact_repo.create_async(
                    run_id=run_id,
                    persona="publisher",
                    artifact_type=ArtifactType.PUBLISHER_OUTPUT,
                    content=publisher_output,
                    metadata={"step": "publisher", "video_url": video_url, "fake": True},
                )

                # Store fake published URL as artifact (use async method)
                await artifact_repo.create_async(
                    run_id=run_id,
                    persona="publisher",
                    artifact_type=ArtifactType.PUBLISHED_URL,
                    uri=fake_published_url,
                    metadata={"step": "publisher", "platform": "tiktok", "fake": True},
                )

                # Persist final run status so DB reflects completion in fake mode
                await run_repo.update_async(
                    run_id,
                    status=RunStatus.COMPLETED.value,
                    current_step="completed",
                )
                await session.commit()

                logger.info(
                    "Fake provider mode: returning fake published URL immediately for run %s",
                    run_id,
                )

                return {
                    "published_urls": [fake_published_url],
                    "status": RunStatus.COMPLETED.value,
                    "current_step": "completed",
                }

            # Real mode: call publisher agent and execute tool calls
            # Guard-first: check input safety (replay-aware caching)
            publisher_prompt = f"Publish this video: {video_url}"
            if topic:
                publisher_prompt += f"\n\nTopic: {topic}"
            input_messages = [{"role": "user", "content": publisher_prompt}]
            sanitized_prompt = _strip_noise_for_safety(publisher_prompt)
            safety_messages = (
                [{"role": "user", "content": sanitized_prompt}]
                if sanitized_prompt
                else input_messages
            )
            input_safety = await check_agent_input(
                state, async_client, "publishing_input", safety_messages
            )
            if not getattr(input_safety, "safe", False):
                logger.warning("Publishing input blocked by safety: %s", input_safety.reason)
                return {
                    "error": f"Input safety check failed: {input_safety.reason}",
                    "status": RunStatus.FAILED.value,
                }

            # Call publisher agent - tools are executed automatically by Llama Stack
            published_urls: list[str] = []
            tool_result = None
            status_url = None
            request_id = None
            tool_response_payloads: list[dict[str, Any]] = []
            with agent_session(client, publisher, f"run-{run_id}-publisher") as session_id:
                response, tool_response_payloads = await anyio.to_thread.run_sync(
                    _create_turn_collecting_tool_responses,
                    publisher,
                    input_messages,
                    session_id,
                )

                publisher_output = extract_content(response)

                logger.info(
                    "Collected %d tool responses from publisher turn",
                    len(tool_response_payloads),
                )

                for content in _tool_response_contents_from_payloads(
                    tool_response_payloads, "upload_post"
                ):
                    published_url = None
                    if isinstance(content, dict):
                        tool_result = content
                    elif isinstance(content, str):
                        try:
                            tool_result = json.loads(content)
                        except Exception:
                            tool_result = None
                    else:
                        tool_result = None

                    if isinstance(tool_result, dict):
                        data = tool_result.get("data", {}) if "data" in tool_result else tool_result
                        status_url = status_url or (
                            data.get("status_url") or data.get("statusUrl") or data.get("status")
                        )
                        request_id = request_id or data.get("request_id") or data.get("requestId")
                        published_url = data.get("published_url") or tool_result.get(
                            "published_url"
                        )

                    if published_url:
                        published_urls.append(published_url)
                        logger.info("Video published via upload_post: %s", published_url)
                        break

                if not published_urls and not status_url:
                    logger.error("Publisher did not execute upload_post tool via Llama Stack")
                    return {
                        "error": "Publisher did not execute upload_post tool. Check agent instructions and tool configuration.",
                        "status": RunStatus.FAILED.value,
                    }

            # Check output safety only on semantic content (strip tool receipts/IDs).
            sanitized_publisher_output = _strip_noise_for_safety(publisher_output)
            if sanitized_publisher_output:
                safety_result = await check_agent_output(
                    state, async_client, "publishing_output", sanitized_publisher_output
                )
                if not getattr(safety_result, "safe", False):
                    logger.warning(
                        "Publishing output blocked by safety: %s", safety_result.reason
                    )
                    return {
                        "error": f"Safety check failed: {safety_result.reason}",
                        "status": RunStatus.FAILED.value,
                    }

            # Store publisher output (use async method)
            await artifact_repo.create_async(
                run_id=run_id,
                persona="publisher",
                artifact_type=ArtifactType.PUBLISHER_OUTPUT,
                content=publisher_output,
                metadata={"step": "publisher", "video_url": video_url},
            )

            # Store safety cache artifact
            await _maybe_store_safety_cache(state, artifact_repo, run_id)

            # If URLs already available, persist and finish
            if published_urls:
                tool_result_data = tool_result.get("data", {}) if tool_result else {}
                for published_url in published_urls:
                    await artifact_repo.create_async(
                        run_id=run_id,
                        persona="publisher",
                        artifact_type=ArtifactType.PUBLISHED_URL,
                        uri=published_url,
                        metadata={
                            "step": "publisher",
                            "platform": tool_result_data.get("platform", "tiktok"),
                            "video_url": video_url,  # Store for idempotency
                            "publish_id": tool_result_data.get("publish_id") or request_id,
                            "account_id": tool_result_data.get("account_id"),
                        },
                    )

                await run_repo.update_async(
                    run_id, status=RunStatus.COMPLETED.value, current_step="completed"
                )
                await session.commit()

                logger.info("Publishing complete for run %s", run_id)

                return {
                    "published_urls": published_urls,
                    "publish_complete": True,
                    "status": RunStatus.COMPLETED.value,
                    "current_step": "completed",
                }

            # Fail-fast: publishing must return URLs (no background polling/webhook support).
            error = (
                "Publishing did not return a published URL. "
                "Async publish (status_url) is not supported."
            )
            if status_url:
                error = f"{error} status_url={status_url}"
            if request_id:
                error = f"{error} request_id={request_id}"

            await run_repo.update_async(
                run_id,
                status=RunStatus.FAILED.value,
                current_step="publishing",
                error=error,
            )
            await session.commit()

            return {
                "error": error,
                "status": RunStatus.FAILED.value,
            }

        except Exception as exc:
            logger.exception("Publishing node failed: %s", exc)
            await session.rollback()
            return {
                "error": str(exc),
                "status": RunStatus.FAILED.value,
            }
