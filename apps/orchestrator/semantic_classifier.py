"""Semantic classification of user requests to determine project and customizations."""
from __future__ import annotations

from typing import Literal, cast

from pydantic import BaseModel, Field

try:
    from langchain_openai import ChatOpenAI
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False

ProjectName = Literal["aismr", "test_video_gen"]
Complexity = Literal["simple", "standard", "complex"]


class ProjectClassification(BaseModel):
    """Classification result from semantic analysis."""
    project: ProjectName
    object: str  # e.g., "candles", "AI concepts"
    complexity: Complexity
    skip_steps: list[str] = Field(default_factory=list)
    optional_personas: list[str] = Field(default_factory=list)
    custom_requirements: list[str] = Field(default_factory=list)


def classify_request(user_request: str) -> ProjectClassification:
    """Classify user request to determine project, object, complexity, and customizations.
    
    Uses LLM with structured output to analyze the request semantically.
    """
    if not LANGCHAIN_AVAILABLE:
        return _fallback_classification(user_request)
    
    # Use LLM for proper classification
    llm = ChatOpenAI(model="gpt-5-nano", temperature=0.2)
    
    system_prompt = """You are a semantic classifier for MyloWare content requests.
Analyze the user's request and classify:
- project: Which project (aismr or test_video_gen)
- object: What object/subject they want (e.g., "candles", "books", "AI concepts")
- complexity: simple (skip editing), standard (full pipeline), or complex (add custom steps)
- skip_steps: List of steps to skip (e.g., ["alex"] for no editing)
- custom_requirements: Any special requirements mentioned

Examples:
- "Make an AISMR video about candles" → project=aismr, object=candles, complexity=standard
- "Make a test video" → project=test_video_gen, object=test, complexity=standard
"""
    
    # Use structured output
    try:
        structured_llm = llm.with_structured_output(ProjectClassification)
        result = structured_llm.invoke(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_request},
            ]
        )
        return cast(ProjectClassification, result)
    except Exception:
        return _fallback_classification(user_request)


def _fallback_classification(user_request: str) -> ProjectClassification:
    request_lower = user_request.lower()
    project: ProjectName
    if "aismr" in request_lower or "surreal" in request_lower:
        project = "aismr"
    else:
        project = "test_video_gen"

    object_name = "objects"
    for word in ["candles", "books", "candle", "book", "ai"]:
        if word in request_lower:
            object_name = word.rstrip("s")
            break

    if "simple" in request_lower:
        complexity: Complexity = "simple"
    elif "complex" in request_lower:
        complexity = "complex"
    else:
        complexity = "standard"

    skip_steps: list[str] = []
    if "no editing" in request_lower or complexity == "simple":
        skip_steps.append("alex")
    optional_personas: list[str] = []
    if "soundtrack" in request_lower or "sound design" in request_lower or "custom music" in request_lower:
        optional_personas.append("morgan")

    return ProjectClassification(
        project=project,
        object=object_name,
        complexity=complexity,
        skip_steps=skip_steps,
        optional_personas=optional_personas,
        custom_requirements=[],
    )
