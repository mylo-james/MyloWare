"""Brendan's LangChain agent with RAG and run tracking tools."""
from __future__ import annotations

# mypy: ignore-errors

import json
import logging
from pathlib import Path
from typing import Any, Mapping, Sequence

import httpx

from core.runs.schema import build_graph_spec

try:
    from langchain_core.tools import tool
    from langchain_core.messages import HumanMessage, AIMessage
    from langchain_openai import ChatOpenAI
    from langchain.agents import create_agent  # LangChain v1.0 standard
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False

from prometheus_client import Counter

from .brendan_state import ConversationState
from .config import settings
from .graph_factory import load_project_spec
from .semantic_classifier import classify_request
from .supervisor.decision import decide_supervisor_action


def _normalize_db_url(url: str) -> str:
    """Convert SQLAlchemy-style psycopg URLs to psycopg-compatible DSNs."""
    return url.replace("postgresql+psycopg://", "postgresql://", 1)

try:
    from core.knowledge.retrieval import search_kb
    RETRIEVAL_AVAILABLE = True
except ImportError:
    RETRIEVAL_AVAILABLE = False

logger = logging.getLogger("myloware.orchestrator.brendan")

supervisor_decisions_total = Counter(
    "supervisor_decisions_total",
    "Supervisor decisions by outcome",
    ["decision"],
)


def _load_brendan_prompt() -> str:
    """Load Brendan's system prompt from data/personas/brendan/.
    
    Falls back to a default prompt only for Brendan (supervisor persona).
    """
    base = Path(__file__).resolve().parent.parent / "data" / "personas" / "brendan"
    errors: list[str] = []
    
    for path in [base / "persona.json", base / "brendan.json"]:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                prompt = data.get("systemPrompt") or data.get("prompt")
                if prompt:
                    logger.info(f"Loaded Brendan prompt from {path}")
                    return prompt
                else:
                    errors.append(f"{path}: No systemPrompt or prompt field")
            except Exception as exc:
                error_msg = f"{path}: {exc}"
                logger.warning(f"Failed to load Brendan prompt from {path}: {exc}")
                errors.append(error_msg)
    
    # Brendan gets a hardcoded fallback since he's a supervisor
    logger.warning(f"Using fallback prompt for Brendan. Errors: {errors if errors else 'No files found'}")
    return """You are Brendan, the Showrunner for MyloWare. You help users understand projects, 
track their runs, and create content. Use your tools to search the knowledge base, list runs, 
and get run status. When users want to create content, use build_and_start_graph."""


_DEFAULT_PIPELINE = ["iggy", "riley", "alex", "quinn"]
_VALID_HITL_GATES = {"ideate", "prepublish"}


def _normalized_persona(name: str | None) -> str:
    return (name or "").strip()


def _derive_pipeline(
    project: str,
    project_spec: Mapping[str, Any],
    skip_steps: Sequence[str] | None = None,
    optional_personas: Sequence[str] | None = None,
) -> list[str]:
    workflow = list(project_spec.get("workflow") or project_spec.get("settings", {}).get("workflow") or [])
    if not workflow:
        workflow = list(_DEFAULT_PIPELINE)
    normalized: list[str] = []
    for persona in workflow:
        clean = _normalized_persona(persona)
        if not clean:
            continue
        if clean.lower() in {"brendan", "supervisor"}:
            continue
        normalized.append(clean)
    skip = {step.strip().lower() for step in (skip_steps or []) if step}
    if skip:
        filtered = [persona for persona in normalized if persona.lower() not in skip]
    else:
        filtered = normalized

    optional_list = [step.strip() for step in (optional_personas or []) if step]
    for persona in optional_list:
        lower = persona.lower()
        if not lower or lower in {name.lower() for name in filtered}:
            continue
        if "quinn" in [p.lower() for p in filtered]:
            idx = next(i for i, name in enumerate(filtered) if name.lower() == "quinn")
            filtered.insert(idx, persona)
        else:
            filtered.append(persona)
    return filtered or list(_DEFAULT_PIPELINE)


def _extract_hitl_points(project_spec: Mapping[str, Any]) -> list[str]:
    hitl_points = (
        project_spec.get("hitlPoints")
        or project_spec.get("settings", {}).get("hitlPoints")
        or []
    )
    return [str(point) for point in hitl_points if point]


def start_run_from_brendan(*, state: ConversationState, user_request: str) -> dict[str, Any]:
    """Start a production run by calling the API directly (no workflow gate)."""

    classification = classify_request(user_request)
    score = 0.80  # TODO: surface actual classifier confidence
    decision = decide_supervisor_action(score)
    supervisor_decisions_total.labels(decision=decision).inc()
    logger.info(
        "Supervisor decision",
        extra={
            "decision": decision,
            "score": score,
            "project": classification.project,
            "user_id": state.get("user_id"),
        },
    )

    project_spec = load_project_spec(classification.project)
    pipeline = _derive_pipeline(
        classification.project,
        project_spec,
        classification.skip_steps,
        classification.optional_personas,
    )
    hitl_points = _extract_hitl_points(project_spec)
    graph_spec = build_graph_spec(pipeline=pipeline, hitl_gates=hitl_points)

    run_input = {"prompt": user_request}
    options: dict[str, Any] = {
        "entrypoint": "brendan",
        "user_id": state.get("user_id"),
        "classification": classification.model_dump(),
        "requested_pipeline": pipeline,
        "requested_hitl_gates": hitl_points,
        "complexity": classification.complexity,
    }
    if classification.custom_requirements:
        options["custom_requirements"] = list(classification.custom_requirements)
    if classification.optional_personas:
        options["optional_personas"] = list(classification.optional_personas)

    payload = {
        "project": classification.project,
        "input": run_input,
        "options": options,
    }
    api_base = settings.api_base_url.rstrip("/")
    try:
        logger.info(
            "Brendan starting run via API",
            extra={
                "api_base": api_base,
                "project": classification.project,
                "user_id": state.get("user_id"),
            },
        )
        response = httpx.post(
            f"{api_base}/v1/runs/start",
            json=payload,
            headers={"x-api-key": settings.api_key},
            timeout=20.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error(
            "Failed to start run via API",
            extra={"project": classification.project, "user_id": state.get("user_id")},
            exc_info=exc,
        )
        raise
    data = response.json()
    run_id = data.get("runId") or data.get("run_id")
    run_ids = state.setdefault("run_ids", [])
    if run_id:
        run_ids.append(run_id)
        state["pending_gate"] = {"run_id": run_id, "gate": "ideate"}
    else:
        logger.warning("API response missing run_id", extra={"project": classification.project})

    return {
        "run_id": run_id,
        "project": classification.project,
        "graph_spec": graph_spec,
        "pipeline": graph_spec.get("pipeline", []),
        "hitl_gates": graph_spec.get("hitl_gates", []),
        "status": data.get("status", "running"),
        "message": f"Run {run_id} started for {classification.project}; awaiting persona progress.",
    }


def run_brendan_agent(state: ConversationState) -> dict[str, Any]:
    """Run Brendan's agent step, returning state updates."""
    if not LANGCHAIN_AVAILABLE:
        return {
            "response": "Brendan is processing your request. (LangChain unavailable)",
            "messages": state.get("messages", []) + [
                {"role": "user", "content": state.get("current_message", "")},
                {"role": "assistant", "content": "Brendan is processing..."}
            ]
        }

    user_id = state.get("user_id", "unknown")
    current_message = state.get("current_message", "")

    # Define Brendan's tools
    @tool("memory_search")
    def memory_search(query: str, k: int = 5) -> str:
        """Search the shared knowledge base for any topic."""
        if not RETRIEVAL_AVAILABLE:
            return "Knowledge base unavailable right now."
        try:
            dsn = _normalize_db_url(settings.db_url)
            results, latency_ms = search_kb(dsn, query, k=k, project=None, persona=None)
        except Exception as exc:  # pragma: no cover - transient DB failures
            error_msg = str(exc)
            # If pgvector extension missing, return gracefully rather than blocking execution
            if "vector" in error_msg.lower() and "does not exist" in error_msg.lower():
                logger.warning("pgvector extension not available; skipping KB search", extra={"query": query})
                return "Knowledge base requires pgvector extension (not currently available). Proceeding without KB context."
            logger.error("Memory search failed", extra={"query": query}, exc_info=exc)
            return f"Search error: {exc}"

        trimmed = results[:k]
        trace = {
            "query": query,
            "topK": k,
            "latency_ms": latency_ms,
            "docIds": [doc_id for doc_id, *_ in trimmed],
        }
        state.setdefault("retrieval_traces", []).append(trace)
        if not trimmed:
            return "No documents found."
        lines = [
            f"{idx + 1}. {path} (score {score:.3f}) — {snippet[:200]}"
            for idx, (_, path, score, snippet) in enumerate(trimmed)
        ]
        return "\n".join(lines)

    @tool("list_my_runs")
    def list_my_runs(user_id: str, limit: int = 10) -> str:
        """List active and recent runs for a user."""
        try:
            import psycopg
        except ImportError:  # pragma: no cover - optional dependency
            logger.error("psycopg is not installed; cannot list runs")
            return "Database driver unavailable."

        try:
            with psycopg.connect(_normalize_db_url(settings.db_url), autocommit=True) as conn:
                rows = conn.execute(
                    """
                    SELECT run_id, project, status, created_at
                    FROM runs
                    WHERE payload->>'user_id' = %s OR payload->>'user_id' IS NULL
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (user_id, limit),
                ).fetchall()
        except Exception as exc:  # pragma: no cover - DB connection noise
            logger.error("Failed to list runs", extra={"user_id": user_id}, exc_info=exc)
            return f"Error listing runs: {exc}"

        if not rows:
            return f"No runs found for user {user_id}."

        lines = [f"- {row[0]} ({row[1]}) — {row[2]} — {row[3]}" for row in rows]
        return f"Found {len(rows)} runs:\n" + "\n".join(lines)

    @tool("get_run_status")
    def get_run_status(run_id: str) -> str:
        """Get detailed status for a specific run."""
        try:
            import psycopg
        except ImportError:  # pragma: no cover
            logger.error("psycopg is not installed; cannot load run status")
            return "Database driver unavailable."

        try:
            with psycopg.connect(_normalize_db_url(settings.db_url), autocommit=True) as conn:
                run_row = conn.execute("SELECT * FROM runs WHERE run_id = %s", (run_id,)).fetchone()
                if not run_row:
                    return f"Run {run_id} not found."
                artifacts = conn.execute(
                    "SELECT type, persona, created_at FROM artifacts WHERE run_id = %s ORDER BY created_at",
                    (run_id,),
                ).fetchall()
        except Exception as exc:  # pragma: no cover
            logger.error("Failed to get run status", extra={"run_id": run_id}, exc_info=exc)
            return f"Error getting run status: {exc}"

        result = [
            f"Run {run_id}:",
            f"Project: {run_row[1]}",
            f"Status: {run_row[2]}",
            f"Created: {run_row[5]}",
        ]
        if artifacts:
            result.append(f"\nArtifacts ({len(artifacts)}):")
            for art in artifacts:
                result.append(f"  - {art[0]} ({art[1] or 'unknown'}) at {art[2]}")
        return "\n".join(result)

    @tool("build_and_start_graph")
    def build_and_start_graph_tool(user_request: str) -> str:
        """Start a production graph via the canonical orchestrator endpoint."""
        try:
            result = start_run_from_brendan(state=state, user_request=user_request)
        except Exception as exc:  # pragma: no cover - API flake
            logger.error(
                "Failed to build and start graph",
                extra={"user_id": state.get("user_id"), "user_request": user_request},
                exc_info=exc,
            )
            return f"Error: {exc}"
        return json.dumps(result)

    def _resolve_target_run_id(explicit: str | None) -> str | None:
        if explicit:
            return explicit
        pending = state.get("pending_gate") or {}
        if pending.get("run_id"):
            return pending.get("run_id")
        run_ids = state.get("run_ids") or []
        return run_ids[-1] if run_ids else None

    def _normalize_gate(value: str | None) -> str:
        if not value:
            return "ideate"
        cleaned = str(value).strip().lower()
        return cleaned if cleaned in _VALID_HITL_GATES else "ideate"

    def _resolve_target_gate(explicit: str | None) -> str:
        if explicit:
            return _normalize_gate(explicit)
        pending = state.get("pending_gate") or {}
        return _normalize_gate(pending.get("gate"))

    api_base = settings.api_base_url.rstrip("/")

    def _request_gate_link(target_gate: str, run_id: str | None) -> str:
        canonical_gate = _normalize_gate(target_gate)
        target_run = _resolve_target_run_id(run_id)
        if not target_run:
            return "No run available for approval links right now."
        try:
            response = httpx.get(
                f"{api_base}/v1/hitl/link/{target_run}/{canonical_gate}",
                headers={"x-api-key": settings.api_key},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            return f"Approval link for {canonical_gate or target_gate} on {target_run}: {data.get('approvalUrl')}"
        except Exception as exc:
            logger.error("Failed to fetch approval link", exc_info=exc)
            return f"Failed to fetch approval link: {exc}"

    def _approve_gate(target_gate: str, run_id: str | None) -> str:
        canonical_gate = _normalize_gate(target_gate)
        target_run = _resolve_target_run_id(run_id)
        if not target_run:
            return "No pending HITL gate to approve."
        timeout_seconds = 8.0
        attempts = 3
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                response = httpx.get(
                    f"{api_base}/v1/hitl/approve/{target_run}/{canonical_gate}",
                    headers={"x-api-key": settings.api_key},
                    timeout=timeout_seconds,
                )
                response.raise_for_status()
                data = response.json()
                state["pending_gate"] = None
                return f"Approved {canonical_gate or target_gate} gate for {target_run}: {data.get('status', 'approved')}"
            except Exception as exc:  # pragma: no cover - network volatility
                last_error = exc
                logger.warning(
                    "Approve gate request failed",
                    extra={
                        "run_id": target_run,
                        "gate": canonical_gate or target_gate,
                        "attempt": attempt,
                        "max_attempts": attempts,
                    },
                    exc_info=exc,
                )
        logger.error(
            "Failed to approve gate after retries",
            extra={"run_id": target_run, "gate": canonical_gate or target_gate},
            exc_info=last_error,
        )
        return f"Failed to approve {canonical_gate or target_gate} gate after {attempts} attempts: {last_error}"

    @tool("request_hitl_link")
    def request_hitl_link(run_id: str | None = None, gate: str | None = None) -> str:
        """Return a signed HITL approval link for the given run and gate."""
        target_gate = _resolve_target_gate(gate)
        return _request_gate_link(target_gate, run_id)

    @tool("approve_hitl_gate")
    def approve_hitl_gate(run_id: str | None = None, gate: str | None = None) -> str:
        """Approve a HITL gate (ideate or prepublish) for the target run."""
        target_gate = _resolve_target_gate(gate)
        return _approve_gate(target_gate, run_id)
    
    tools = [
        memory_search,
        list_my_runs,
        get_run_status,
        build_and_start_graph_tool,
        request_hitl_link,
        approve_hitl_gate,
    ]

    system_prompt = _load_brendan_prompt()

    # Create agent using LangChain v1.0's create_agent
    model = ChatOpenAI(model="gpt-5-nano", temperature=0.2)
    agent_graph = create_agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt
    )
    
    # Prepare conversation history using LangChain message objects
    
    messages = state.get("messages", [])
    langchain_messages = []
    
    # Add last 5 messages for context
    for msg in messages[-5:]:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            langchain_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            langchain_messages.append(AIMessage(content=content))
    
    # Add current message
    langchain_messages.append(HumanMessage(content=current_message))
    
    # Invoke the agent graph
    result = agent_graph.invoke({"messages": langchain_messages})
    # Extract response from messages (last message is the AI response)
    result_messages = result.get("messages", [])
    response_text = result_messages[-1].content if result_messages else "I'm processing your request."

    # Update messages
    updated_messages = messages + [
        {"role": "user", "content": current_message},
        {"role": "assistant", "content": response_text}
    ]
    
    return {
        "response": response_text,
        "messages": updated_messages,
        "retrieval_traces": state.get("retrieval_traces", []),
        "citations": state.get("citations", []),
        "pending_gate": state.get("pending_gate"),
        "run_ids": state.get("run_ids", []),
    }
