"""Semantic request classification for Supervisor supervisor."""

from __future__ import annotations

import json
import logging
from typing import Literal, Optional

from langfuse import observe
from pydantic import BaseModel, Field

from llama_stack_client import LlamaStackClient

logger = logging.getLogger("agents.classifier")

ProjectName = Literal["test_video_gen", "aismr", "unknown"]
RequestIntent = Literal[
    "start_run",
    "check_status",
    "approve_gate",
    "list_runs",
    "help",
    "unknown",
]


class ClassificationResult(BaseModel):
    """Result of classifying a user request."""

    intent: RequestIntent = Field(description="What the user wants to do")
    project: Optional[ProjectName] = Field(
        default=None, description="Target project if starting a run"
    )
    run_id: Optional[str] = Field(default=None, description="Run ID if provided")
    gate: Optional[str] = Field(default=None, description="Gate name if approving")
    custom_object: Optional[str] = Field(default=None, description="Custom subject/object")
    skip_steps: list[str] = Field(default_factory=list, description="Steps to skip")
    confidence: float = Field(default=1.0, description="Classification confidence (0-1)")


CLASSIFICATION_PROMPT = """You are a request classifier for MyloWare, a video production platform.

Analyze the user's message and classify:
1. intent: What they want to do
   - "start_run": Start a new video production workflow
   - "check_status": Check status of a run
   - "approve_gate": Approve a HITL gate
   - "list_runs": List their runs
   - "help": Need help or information
   - "unknown": Can't determine intent

2. project: Which project (if starting a run)
   - "test_video_gen": Simple test with moon/sun videos (keywords: test, simple, demo)
   - "aismr": Full ASMR production (keywords: asmr, satisfying, calming)
   - null if not starting a run

3. run_id: Extract run ID if mentioned (UUID format like abc-123-def-456)

4. gate: Gate name if approving (ideation, publish)

5. custom_object: Custom subject if specified (e.g., "candles", "books")

6. skip_steps: List of steps to skip if mentioned

Return a JSON object with keys: intent, project, run_id, gate, custom_object, skip_steps, confidence.
"""


@observe(as_type="generation", name="classify_request")
def classify_request(
    client: LlamaStackClient,
    user_message: str,
    model: str = "openai/gpt-4o-mini",
) -> ClassificationResult:
    """Classify a user request using Llama Stack chat completion with JSON output.

    Raises:
        RuntimeError: If LLM classification fails (fail fast - no fallbacks).
    """
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": CLASSIFICATION_PROMPT},
            {"role": "user", "content": f"Classify this request: {user_message}"},
        ],
        response_format={"type": "json_object"},
        stream=False,
    )

    # Handle OpenAI-style response format
    if not response.choices:
        raise RuntimeError("LLM classification returned no choices")

    message = response.choices[0].message
    text = getattr(message, "content", "")
    if not text:
        raise RuntimeError("LLM classification returned empty content")

    data = json.loads(text)

    # Handle confidence - LLM might return "high", "medium", etc. instead of a number
    raw_confidence = data.get("confidence", 0.8)
    if isinstance(raw_confidence, (int, float)):
        confidence = float(raw_confidence)
    elif isinstance(raw_confidence, str):
        # Map string confidence to numeric values
        confidence_map = {"high": 0.9, "medium": 0.7, "low": 0.5}
        confidence = confidence_map.get(raw_confidence.lower(), 0.8)
    else:
        confidence = 0.8

    result = ClassificationResult(
        intent=data.get("intent", "unknown"),
        project=data.get("project") or None,
        run_id=data.get("run_id") or None,
        gate=data.get("gate") or None,
        custom_object=data.get("custom_object") or None,
        skip_steps=data.get("skip_steps") or [],
        confidence=confidence,
    )

    logger.info(
        "Classified request via LLM",
        extra={
            "intent": result.intent,
            "project": result.project,
            "confidence": result.confidence,
        },
    )
    return result


__all__ = [
    "ClassificationResult",
    "classify_request",
    "ProjectName",
    "RequestIntent",
]
