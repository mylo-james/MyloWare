"""LangGraph workflow nodes.

Each node implements a step in the video production workflow.
Nodes use Llama Stack agents and return state updates.
"""

from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Mapping, Optional
from uuid import UUID

from langgraph.types import interrupt, RunnableConfig

import anyio
import httpx

from myloware.agents.factory import create_agent
from myloware.config import settings
from myloware.config.provider_modes import (
    effective_llama_stack_provider,
    effective_remotion_provider,
    effective_sora_provider,
)
from myloware.llama_clients import get_async_client, get_sync_client
from myloware.observability.logging import get_logger
from myloware.storage.database import get_async_session_factory  # get_session used in tests
from myloware.storage.models import ArtifactType, RunStatus
from myloware.storage.repositories import ArtifactRepository, RunRepository
from myloware.workflows.extractors import get_extractor
from myloware.workflows.helpers import extract_trace_id
from myloware.workflows.langgraph.agent_io import (
    _maybe_store_safety_cache,
    _strip_noise_for_safety,
    _tool_response_contents_from_payloads,
    agent_session,
    create_turn_collecting_tool_responses,
    extract_content,
)
from myloware.workflows.langgraph.safety_cache import (
    guard_input_with_cache,
    guard_output_with_cache,
)
from myloware.workflows.langgraph.state import VideoWorkflowState
from myloware.workflows.langgraph.utils import sorted_video_clip_artifacts
from myloware.workflows.parsers import parse_structured_ideation

# Expose safety helpers for monkeypatching in tests (backwards compatibility)
check_agent_input = guard_input_with_cache
check_agent_output = guard_output_with_cache

logger = get_logger(__name__)


def _run_guard(client: Any, content: str | None = None) -> None:
    """Run output safety guard when external services are enabled.

    In production we call the client's safety shield; in tests we no-op to keep
    unit tests isolated.
    """
    if settings.disable_background_workflows or effective_llama_stack_provider(settings) != "real":
        return
    # Minimal guard hook used by tests; real shielding happens in step code
    if hasattr(client, "safety") and hasattr(client.safety, "run_shield"):
        client.safety.run_shield(content=content or "")


def _extract_upload_post_urls(payload: Any) -> list[str]:
    """Extract published URLs from Upload-Post status payloads."""
    urls: list[str] = []

    def _add_url(value: Any) -> None:
        if isinstance(value, str) and value:
            urls.append(value)

    def _handle_obj(obj: Any) -> None:
        if not isinstance(obj, Mapping):
            return
        for key in ("post_url", "published_url", "url", "canonicalUrl", "link"):
            _add_url(obj.get(key))
        # Some responses nest URL under response/data
        for nested_key in ("response", "data", "result"):
            nested = obj.get(nested_key)
            if isinstance(nested, Mapping):
                for key in ("post_url", "published_url", "url", "canonicalUrl", "link"):
                    _add_url(nested.get(key))

    if isinstance(payload, Mapping):
        _handle_obj(payload)
        for list_key in ("results", "data", "uploads", "items"):
            items = payload.get(list_key)
            if isinstance(items, list):
                for item in items:
                    _handle_obj(item)
            elif isinstance(items, Mapping):
                _handle_obj(items)

    # De-duplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


def _extract_upload_post_status(payload: Any) -> str | None:
    """Return normalized status string from Upload-Post payload."""
    if not isinstance(payload, Mapping):
        return None
    status = (
        payload.get("status")
        or payload.get("state")
        or payload.get("processing_status")
        or payload.get("result")
    )
    if isinstance(status, str):
        return status.strip().lower()
    return None


async def _poll_upload_post_status(
    status_url: str,
    *,
    request_id: str | None = None,
) -> tuple[list[str], str | None, dict[str, Any] | None]:
    """Poll Upload-Post status endpoint until completion or timeout."""
    poll_interval = max(1.0, float(getattr(settings, "upload_post_poll_interval_s", 10.0)))
    poll_timeout = max(poll_interval, float(getattr(settings, "upload_post_poll_timeout_s", 600.0)))
    deadline = time.monotonic() + poll_timeout

    headers: dict[str, str] = {}
    if settings.upload_post_api_key:
        headers["Authorization"] = f"Apikey {settings.upload_post_api_key}"

    last_payload: dict[str, Any] | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            response = await client.get(status_url, headers=headers)
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                last_payload = payload
            else:
                last_payload = {"raw": payload}

            published_urls = _extract_upload_post_urls(last_payload)
            if published_urls:
                return published_urls, None, last_payload

            status = _extract_upload_post_status(last_payload)
            if status in {"failed", "error", "rejected", "canceled", "cancelled"}:
                error = f"Upload-Post status indicates failure ({status})"
                if request_id:
                    error = f"{error} request_id={request_id}"
                return [], error, last_payload
            if last_payload.get("success") is False:
                error = "Upload-Post status returned success=false"
                if request_id:
                    error = f"{error} request_id={request_id}"
                return [], error, last_payload

            if time.monotonic() >= deadline:
                error = f"Timed out waiting for Upload-Post status after {int(poll_timeout)}s"
                if request_id:
                    error = f"{error} request_id={request_id}"
                return [], error, last_payload

            await anyio.sleep(poll_interval)


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
                response, _tool_response_payloads = await anyio.to_thread.run_sync(
                    create_turn_collecting_tool_responses,
                    ideator,
                    input_messages,
                    session_id,
                )

                ideas = extract_content(response)

            # Check output safety (inference → guard) with caching for replay/time-travel
            safety_result = await check_agent_output(state, async_client, "ideation_output", ideas)
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
                from myloware.config.projects import load_project

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
            "gate": "ideation",
            "waiting_for": "hitl_ideation",
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
            if (
                settings.disable_background_workflows
                or effective_llama_stack_provider(settings) != "real"
            ):
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

            # Proactively move the run into the "production" phase before waiting
            # on producer inference/tool execution so the UI is not stuck on the
            # ideation gate while the producer prepares Sora prompts.
            await run_repo.update_async(
                run_id,
                status=RunStatus.AWAITING_VIDEO_GENERATION.value,
                current_step="producer",
            )
            await session.commit()

            # Call producer agent to generate videos (guard → inference)
            tool_response_payloads: list[dict[str, Any]] = []
            with agent_session(client, producer, f"run-{run_id}-producer") as session_id:
                response, tool_response_payloads = await anyio.to_thread.run_sync(
                    create_turn_collecting_tool_responses,
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
                    logger.warning("Production output blocked by safety: %s", safety_result.reason)
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
            for content in _tool_response_contents_from_payloads(
                tool_response_payloads, "sora_generate"
            ):
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
                error_detail = f"Failed to submit video generation jobs: {tool_execution_error}"
                try:
                    await run_repo.update_async(
                        run_id,
                        status=RunStatus.FAILED.value,
                        error=error_detail,
                        current_step="producer",
                    )
                    await session.commit()
                except Exception as status_exc:  # pragma: no cover - defensive
                    logger.warning(
                        "Failed to persist FAILED status for production error (run=%s): %s",
                        run_id,
                        status_exc,
                    )
                return {
                    "error": error_detail,
                    "status": RunStatus.FAILED.value,
                }

            if not sora_tool_executed:
                logger.error("Producer did not execute sora_generate tool via Llama Stack")
                logger.error("Producer output: %s", producer_output[:500])
                error_detail = (
                    "Producer did not execute sora_generate tool. "
                    "Check agent instructions and tool configuration."
                )
                try:
                    await run_repo.update_async(
                        run_id,
                        status=RunStatus.FAILED.value,
                        error=error_detail,
                        current_step="producer",
                    )
                    await session.commit()
                except Exception as status_exc:  # pragma: no cover - defensive
                    logger.warning(
                        "Failed to persist FAILED status for missing tool execution (run=%s): %s",
                        run_id,
                        status_exc,
                    )
                return {
                    "error": error_detail,
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

            # Polling fallback: if OpenAI Standard Webhooks are misconfigured or delayed, a
            # lightweight worker job can poll /v1/videos/{id} and ingest clips so the demo
            # can still complete end-to-end.
            if (
                submitted_task_ids
                and settings.workflow_dispatcher == "db"
                and effective_sora_provider(settings) == "real"
            ):
                from myloware.storage.repositories import JobRepository
                from myloware.workers.job_types import JOB_SORA_POLL, idempotency_sora_poll

                job_repo = JobRepository(session)
                try:
                    await job_repo.enqueue_async(
                        JOB_SORA_POLL,
                        run_id=run_id,
                        payload={},
                        idempotency_key=idempotency_sora_poll(run_id),
                        max_attempts=240,
                    )
                    await session.commit()
                except ValueError:
                    # Enqueue is idempotent; a unique constraint violation leaves the
                    # session in a rollback-only state.
                    await session.rollback()

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
            # Prefer the stable /v1/media/transcoded/* proxy for transcoded clips so
            # prompts remain short and we don't rely on LLMs copying presigned URLs.
            from myloware.storage.object_store import resolve_s3_uri_async
            from myloware.workflows.langgraph.utils import normalize_transcoded_url

            resolved_clip_urls: list[str] = []
            for url in clip_urls:
                normalized = normalize_transcoded_url(str(url))
                if normalized and normalized != url:
                    resolved_clip_urls.append(normalized)
                    continue
                resolved_clip_urls.append(await resolve_s3_uri_async(str(url)))
            clip_urls = resolved_clip_urls

            # Build editor prompt (same as EditingStep)
            from myloware.config.projects import load_project

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

            from myloware.workflows.langgraph.prompts import build_editor_prompt

            editor_prompt = build_editor_prompt(
                project=state["project"],
                clip_urls=clip_urls,
                creative_direction=creative_direction,
                overlays=overlays,
                duration_seconds=float(duration_seconds),
            )

            # Guard-first: check input safety (replay-aware caching).
            #
            # Use a minimized safety payload focused on human/creative content.
            # Full editor prompts include long URL lists / orchestration directives
            # that can trip shield false positives.
            input_messages = [{"role": "user", "content": editor_prompt}]

            overlay_texts: list[str] = []
            for item in overlays:
                if isinstance(item, Mapping):
                    text = item.get("text") or item.get("identifier") or ""
                    if text:
                        overlay_texts.append(str(text))
                elif item:
                    overlay_texts.append(str(item))

            editor_safety_context = (
                f"Project: {state['project']}\n"
                f"Creative direction:\n{creative_direction}\n\n"
                f"Overlays:\n{json.dumps(overlay_texts, ensure_ascii=False)}\n"
            )
            sanitized_prompt = _strip_noise_for_safety(editor_safety_context)
            safety_messages = [
                {"role": "user", "content": sanitized_prompt or editor_safety_context}
            ]
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
            if (
                settings.disable_background_workflows
                or effective_llama_stack_provider(settings) != "real"
            ):
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
                    create_turn_collecting_tool_responses,
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

            # Output safety: the editor's text response is primarily orchestration (tool receipts,
            # IDs, etc.). The human-facing creative payload (direction + overlays) is already
            # validated via the `editing_input` guard above, and final publishing is still gated
            # by HITL approval.

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

            if effective_remotion_provider(settings) == "fake":
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

            # Polling fallback: Fly can autosuspend the Remotion service if there's no inbound
            # traffic, which pauses renders and prevents webhooks from firing. In db-dispatch mode
            # we enqueue a lightweight poller job that keeps the render service warm and advances
            # the workflow once the output is ready.
            if (
                settings.workflow_dispatcher == "db"
                and effective_remotion_provider(settings) == "real"
                and render_job_id
            ):
                from myloware.storage.repositories import JobRepository
                from myloware.workers.job_types import (
                    JOB_REMOTION_POLL,
                    idempotency_remotion_poll,
                )

                job_repo = JobRepository(session)
                try:
                    await job_repo.enqueue_async(
                        JOB_REMOTION_POLL,
                        run_id=run_id,
                        payload={},
                        idempotency_key=idempotency_remotion_poll(run_id, str(render_job_id)),
                        max_attempts=180,
                    )
                    await session.commit()
                except (TypeError, ValueError):
                    # Enqueue is idempotent; a unique constraint violation leaves the
                    # session in a rollback-only state.
                    await session.rollback()

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

    from myloware.services.remotion_urls import normalize_remotion_output_url

    normalized = normalize_remotion_output_url(str(video_url))
    if normalized:
        video_url = normalized

    return {
        "final_video_url": video_url,
        "current_step": "publish_approval",
        "status": RunStatus.AWAITING_PUBLISH_APPROVAL.value,
    }


async def publish_approval_node(state: VideoWorkflowState) -> dict[str, Any]:
    """Human-in-the-loop approval for publishing."""
    logger.info("Publish approval node for run %s", state.get("run_id"))

    # Auto-approve in test mode to keep tests fast
    if settings.disable_background_workflows or effective_llama_stack_provider(settings) != "real":
        return {
            "publish_approved": True,
            "current_step": "publishing",
        }

    # Interrupt and wait for human approval
    approval = interrupt(
        {
            "task": "Review and approve video for publishing",
            "run_id": state["run_id"],
            "gate": "publish",
            "waiting_for": "hitl_publish",
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

            from myloware.services.remotion_urls import normalize_remotion_output_url

            video_url = normalize_remotion_output_url(str(state["final_video_url"])) or str(
                state["final_video_url"]
            )
            artifacts = run.artifacts or {}
            structured = artifacts.get("ideas_structured", {})
            topic = structured.get("topic", "") if isinstance(structured, dict) else ""

            # Test mode (or Llama Stack disabled): skip tool execution and return fake output immediately
            if (
                settings.disable_background_workflows
                or effective_llama_stack_provider(settings) != "real"
            ):
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
            from myloware.workflows.langgraph.prompts import build_publisher_prompt

            publisher_prompt = build_publisher_prompt(
                project=state["project"],
                video_url=str(video_url),
                topic=topic or None,
            )
            input_messages = [{"role": "user", "content": publisher_prompt}]
            publisher_safety_context = (
                f"Project: {state['project']}\n"
                f"Topic: {topic}\n"
                "Action: publish the final video.\n"
            )
            sanitized_prompt = _strip_noise_for_safety(publisher_safety_context)
            safety_messages = [
                {"role": "user", "content": sanitized_prompt or publisher_safety_context}
            ]
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
            tool_error: str | None = None
            tool_response_payloads: list[dict[str, Any]] = []
            with agent_session(client, publisher, f"run-{run_id}-publisher") as session_id:
                response, tool_response_payloads = await anyio.to_thread.run_sync(
                    create_turn_collecting_tool_responses,
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
                        if tool_result.get("error"):
                            tool_error = str(tool_result.get("message") or "Upload-Post failed")
                            logger.error(
                                "upload_post tool returned error (run_id=%s): %s",
                                str(run_id),
                                tool_error,
                            )
                            break
                        data = tool_result.get("data", {}) if "data" in tool_result else tool_result
                        status_url = status_url or (data.get("status_url") or data.get("statusUrl"))
                        request_id = request_id or data.get("request_id") or data.get("requestId")
                        published_url = data.get("published_url") or tool_result.get(
                            "published_url"
                        )

                    if published_url:
                        published_urls.append(published_url)
                        logger.info("Video published via upload_post: %s", published_url)
                        break

                if tool_error:
                    return {"error": tool_error, "status": RunStatus.FAILED.value}

                if not published_urls and not status_url and not request_id:
                    saw_upload_post = any(
                        (
                            (payload.get("tool_name") or payload.get("name") or "")
                            .split("::")[-1]
                            .split("/")[-1]
                            .split(".")[-1]
                            == "upload_post"
                        )
                        for payload in tool_response_payloads
                    )
                    if saw_upload_post:
                        logger.error(
                            "Publisher executed upload_post but response payload was missing expected fields"
                        )
                        return {
                            "error": "Upload-Post tool response was missing expected fields. Check tool configuration and logs.",
                            "status": RunStatus.FAILED.value,
                        }

                    if state.get("project") != "motivational":
                        logger.error("Publisher did not execute upload_post tool via Llama Stack")
                        return {
                            "error": "Publisher did not execute upload_post tool. Check agent instructions and tool configuration.",
                            "status": RunStatus.FAILED.value,
                        }

                    logger.warning(
                        "Publisher did not call upload_post; falling back to direct tool execution (run_id=%s)",
                        str(run_id),
                    )

                    caption_seed = str(topic or state.get("brief") or "").strip()
                    caption_seed = " ".join(caption_seed.split())

                    caption = caption_seed or "New video"
                    tags = ["motivation", "mindset", "selfimprovement", "discipline", "growth"]

                    if len(caption) > 150:
                        caption = caption[:147].rstrip() + "..."

                    try:
                        from myloware.tools.publish import UploadPostTool

                        publish_tool = UploadPostTool(run_id=str(run_id))
                        direct_result = await publish_tool.async_run_impl(
                            video_url=str(video_url),
                            caption=caption,
                            tags=tags,
                        )
                    except Exception as exc:
                        logger.exception(
                            "Fallback upload_post call failed (run_id=%s): %s", str(run_id), exc
                        )
                        return {
                            "error": f"Publish fallback failed: {str(exc)}",
                            "status": RunStatus.FAILED.value,
                        }

                    if isinstance(direct_result, dict):
                        tool_result = direct_result
                    else:
                        tool_result = {"data": direct_result}

                    if isinstance(tool_result, dict) and tool_result.get("error"):
                        tool_error = str(tool_result.get("message") or "Upload-Post failed")
                        return {"error": tool_error, "status": RunStatus.FAILED.value}

                    data = tool_result.get("data", {}) if isinstance(tool_result, dict) else {}
                    if isinstance(tool_result, dict) and not data:
                        data = tool_result

                    status_url = status_url or (data.get("status_url") or data.get("statusUrl"))
                    request_id = request_id or data.get("request_id") or data.get("requestId")
                    published_url = data.get("published_url") or data.get("url")
                    if published_url:
                        published_urls.append(str(published_url))

            # Check output safety only on semantic content (strip tool receipts/IDs).
            sanitized_publisher_output = _strip_noise_for_safety(publisher_output)
            if sanitized_publisher_output:
                safety_result = await check_agent_output(
                    state, async_client, "publishing_output", sanitized_publisher_output
                )
                if not getattr(safety_result, "safe", False):
                    logger.warning("Publishing output blocked by safety: %s", safety_result.reason)
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
                tool_result_data: dict[str, Any] = {}
                if isinstance(tool_result, dict):
                    nested = tool_result.get("data")
                    if isinstance(nested, dict) and nested:
                        tool_result_data = nested
                    else:
                        tool_result_data = tool_result
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

            resolved_status_url = status_url
            if not resolved_status_url and request_id:
                base_url = settings.upload_post_api_url.rstrip("/")
                resolved_status_url = f"{base_url}/api/uploadposts/status?request_id={request_id}"

            if resolved_status_url:
                await run_repo.update_async(
                    run_id,
                    status=RunStatus.AWAITING_PUBLISH.value,
                    current_step="publishing",
                )
                await session.commit()

                published_urls, poll_error, _status_payload = await _poll_upload_post_status(
                    resolved_status_url, request_id=request_id
                )

                if published_urls:
                    tool_result_data = {}
                    if isinstance(tool_result, dict):
                        nested = tool_result.get("data")
                        if isinstance(nested, dict) and nested:
                            tool_result_data = nested
                        else:
                            tool_result_data = tool_result
                    for published_url in published_urls:
                        await artifact_repo.create_async(
                            run_id=run_id,
                            persona="publisher",
                            artifact_type=ArtifactType.PUBLISHED_URL,
                            uri=published_url,
                            metadata={
                                "step": "publisher",
                                "platform": tool_result_data.get("platform", "tiktok"),
                                "video_url": video_url,
                                "publish_id": tool_result_data.get("publish_id") or request_id,
                                "account_id": tool_result_data.get("account_id"),
                                "status_url": resolved_status_url,
                            },
                        )

                    await run_repo.update_async(
                        run_id, status=RunStatus.COMPLETED.value, current_step="completed"
                    )
                    await session.commit()

                    logger.info("Publishing complete after polling for run %s", run_id)

                    return {
                        "published_urls": published_urls,
                        "publish_complete": True,
                        "publish_status_url": resolved_status_url,
                        "status": RunStatus.COMPLETED.value,
                        "current_step": "completed",
                    }

                error = poll_error or "Publishing did not return a published URL."
                await run_repo.update_async(
                    run_id,
                    status=RunStatus.FAILED.value,
                    current_step="publishing",
                    error=error,
                )
                await session.commit()

                return {
                    "error": error,
                    "publish_status_url": resolved_status_url,
                    "status": RunStatus.FAILED.value,
                }

            error = "Publishing did not return a published URL or status_url."
            if request_id:
                error = f"{error} request_id={request_id}"

            await run_repo.update_async(
                run_id,
                status=RunStatus.FAILED.value,
                current_step="publishing",
                error=error,
            )
            await session.commit()

            return {"error": error, "status": RunStatus.FAILED.value}

        except Exception as exc:
            logger.exception("Publishing node failed: %s", exc)
            await session.rollback()
            return {
                "error": str(exc),
                "status": RunStatus.FAILED.value,
            }
