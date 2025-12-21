"""Llama Stack evaluation integration.

Provides evaluation capabilities using the Llama Stack 0.3.x scoring API.
Supports multiple scoring approaches:
- Basic scoring: exact_match, subset_of
- LLM-as-judge: Uses a model to judge response quality
- Custom scoring functions for domain-specific evaluation

Also provides a standalone eval runner for CI/CD pipelines:
- load_eval_dataset(): Load test cases from JSON
- run_eval_pipeline(): Run LLM-as-judge on all test cases
- EvalCase/EvalResult: Data structures for eval results
"""

from __future__ import annotations

import json
import re
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from llama_stack_client import LlamaStackClient

from myloware.config import settings
from myloware.observability.logging import get_logger

logger = get_logger("observability.evaluation")

__all__ = [
    "get_scoring_functions",
    "register_benchmark",
    "run_evaluation",
    "score_responses",
    "evaluate_rows",
    "EvaluationConfig",
    "EvaluationResult",
    # New standalone eval pipeline
    "EvalCase",
    "EvalPipelineResult",
    "load_eval_dataset",
    "run_eval_pipeline",
    "llm_judge_score",
]

# Default scoring functions available in Llama Stack
BASIC_SCORING_FUNCTIONS = [
    "basic::exact_match",
    "basic::subset_of",
    "basic::regex_parser_multiple_choice_answer",
]

LLM_JUDGE_SCORING_FUNCTIONS = [
    "llm-as-judge::quality",
    "llm-as-judge::accuracy",
    "llm-as-judge::safety",
]

DEFAULT_SCORING_FUNCTIONS: list[str] = ["basic::subset_of"]


@dataclass
class EvaluationConfig:
    """Configuration for model evaluation.

    Attributes:
        model_id: Model to evaluate
        sampling_strategy: Sampling strategy (greedy, top_p, top_k)
        max_tokens: Maximum tokens in response
        temperature: Temperature for sampling (only for top_p/top_k)
        top_p: Top-p value for nucleus sampling
        system_message: Optional system prompt
    """

    model_id: str
    sampling_strategy: str = "greedy"
    max_tokens: int = 4096
    temperature: float = 1.0
    top_p: float = 0.95
    system_message: Optional[str] = None

    def to_benchmark_config(self) -> Dict[str, Any]:
        """Convert to benchmark_config format for evaluate_rows."""
        sampling_params: Dict[str, Any] = {
            "max_tokens": self.max_tokens,
            "repeat_penalty": 1.0,
        }

        if self.sampling_strategy == "greedy":
            sampling_params["strategy"] = {"type": "greedy"}
        elif self.sampling_strategy == "top_p":
            sampling_params["strategy"] = {
                "type": "top_p",
                "temperature": self.temperature,
                "top_p": self.top_p,
            }
        else:
            sampling_params["strategy"] = {"type": self.sampling_strategy}

        config: Dict[str, Any] = {
            "eval_candidate": {
                "type": "model",
                "model": self.model_id,
                "sampling_params": sampling_params,
            }
        }

        if self.system_message:
            config["eval_candidate"]["system_message"] = {
                "role": "system",
                "content": self.system_message,
            }

        return config


@dataclass
class EvaluationResult:
    """Results from an evaluation run.

    Attributes:
        benchmark_id: Benchmark that was evaluated
        model_id: Model that was evaluated
        scores: Dictionary of metric_name -> score
        raw_results: Full response from scoring API
        num_examples: Number of examples evaluated
    """

    benchmark_id: str
    model_id: str
    scores: Dict[str, float] = field(default_factory=dict)
    raw_results: Any = None
    num_examples: int = 0

    @property
    def summary(self) -> str:
        """Human-readable summary of results."""
        lines = [f"Evaluation: {self.benchmark_id}"]
        lines.append(f"Model: {self.model_id}")
        lines.append(f"Examples: {self.num_examples}")
        for metric, score in self.scores.items():
            lines.append(f"  {metric}: {score:.3f}")
        return "\n".join(lines)


def get_scoring_functions() -> Dict[str, List[str]]:
    """Return available scoring functions by category.

    Returns:
        Dictionary with 'basic' and 'llm_judge' scoring function lists
    """
    return {
        "basic": BASIC_SCORING_FUNCTIONS.copy(),
        "llm_judge": LLM_JUDGE_SCORING_FUNCTIONS.copy(),
        "default": DEFAULT_SCORING_FUNCTIONS.copy(),
    }


def register_benchmark(
    client: LlamaStackClient,
    benchmark_id: str,
    dataset_id: str,
    scoring_functions: list[str] | None = None,
    metadata: Dict[str, Any] | None = None,
) -> None:
    """Register a benchmark for evaluation.

    Args:
        client: Llama Stack client
        benchmark_id: Unique identifier for the benchmark
        dataset_id: ID of the dataset to evaluate
        scoring_functions: List of scoring function IDs
        metadata: Optional metadata dictionary
    """
    scoring_functions = scoring_functions or DEFAULT_SCORING_FUNCTIONS
    logger.info(
        "Registering benchmark '%s' for dataset '%s' scoring=%s",
        benchmark_id,
        dataset_id,
        scoring_functions,
    )

    client.benchmarks.register(
        benchmark_id=benchmark_id,
        dataset_id=dataset_id,
        scoring_functions=scoring_functions,
        metadata=metadata or {},
    )


def score_responses(
    client: LlamaStackClient,
    input_rows: List[Dict[str, Any]],
    scoring_functions: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Score a batch of responses using the scoring API.

    This is the simplest way to evaluate responses - just provide
    input/output pairs and scoring functions.

    Args:
        client: Llama Stack client
        input_rows: List of dicts with 'input_query', 'expected_answer',
                    and 'generated_answer' keys
        scoring_functions: Dict mapping function names to params (None for defaults)

    Returns:
        Scoring response with results for each row

    Example:
        >>> rows = [
        ...     {"input_query": "What is 2+2?", "expected_answer": "4", "generated_answer": "4"},
        ...     {"input_query": "Capital of France?", "expected_answer": "Paris", "generated_answer": "Paris"},
        ... ]
        >>> results = score_responses(client, rows, {"basic::exact_match": None})
    """
    if scoring_functions is None:
        scoring_functions = {"basic::subset_of": None}

    logger.info(
        "Scoring %d responses with functions: %s", len(input_rows), list(scoring_functions.keys())
    )

    response = client.scoring.score(
        input_rows=input_rows,
        scoring_functions=scoring_functions,
    )

    return response


def evaluate_rows(
    client: LlamaStackClient,
    benchmark_id: str,
    input_rows: List[Dict[str, Any]],
    config: EvaluationConfig,
    scoring_functions: List[str] | None = None,
) -> EvaluationResult:
    """Run evaluation on specific input rows.

    This generates responses from the model and scores them in one step.
    The benchmark must be registered first with register_benchmark().

    Args:
        client: Llama Stack client
        benchmark_id: ID of registered benchmark
        input_rows: Data rows to evaluate (format depends on benchmark)
        config: Evaluation configuration (model, sampling, etc.)
        scoring_functions: Scoring functions to use

    Returns:
        EvaluationResult with scores and raw results

    Example:
        >>> config = EvaluationConfig(model_id="meta-llama/Llama-3.2-8B-Instruct")
        >>> rows = [{"prompt": "What is AI?", "expected": "Artificial Intelligence"}]
        >>> result = evaluate_rows(client, "my-benchmark", rows, config)
        >>> print(result.summary)
    """
    scoring_functions = scoring_functions or DEFAULT_SCORING_FUNCTIONS
    benchmark_config = config.to_benchmark_config()

    logger.info(
        "Evaluating %d rows on benchmark '%s' with model '%s'",
        len(input_rows),
        benchmark_id,
        config.model_id,
    )

    response = client.eval.evaluate_rows(
        benchmark_id=benchmark_id,
        input_rows=input_rows,
        scoring_functions=scoring_functions,
        benchmark_config=benchmark_config,
    )

    # Extract aggregated scores from response
    scores: Dict[str, float] = {}
    if hasattr(response, "aggregated_scores"):
        scores = dict(response.aggregated_scores)
    elif isinstance(response, dict) and "aggregated_scores" in response:
        scores = response["aggregated_scores"]

    return EvaluationResult(
        benchmark_id=benchmark_id,
        model_id=config.model_id,
        scores=scores,
        raw_results=response,
        num_examples=len(input_rows),
    )


def run_evaluation(
    client: LlamaStackClient,
    benchmark_id: str,
    model_id: str,
    scoring_functions: list[str] | None = None,
    judge_model: str | None = None,
    input_rows: List[Dict[str, Any]] | None = None,
    num_examples: int | None = None,
) -> EvaluationResult:
    """Run a full evaluation on a registered benchmark.

    This is the high-level evaluation function that handles the complete
    workflow: configure model, run inference, score results.

    Args:
        client: Llama Stack client
        benchmark_id: ID of the benchmark to run
        model_id: ID of the model to evaluate
        scoring_functions: List of scoring functions (default: subset_of)
        judge_model: Model for LLM-as-judge scoring (if using judge functions)
        input_rows: Specific rows to evaluate (if None, uses benchmark dataset)
        num_examples: Limit evaluation to N examples (optional)

    Returns:
        EvaluationResult with comprehensive results

    Example:
        >>> result = run_evaluation(
        ...     client,
        ...     benchmark_id="qa-benchmark",
        ...     model_id="meta-llama/Llama-3.2-8B-Instruct",
        ...     scoring_functions=["basic::exact_match", "llm-as-judge::accuracy"],
        ...     num_examples=100,
        ... )
        >>> print(f"Accuracy: {result.scores.get('accuracy', 'N/A')}")
    """
    scoring_functions = scoring_functions or DEFAULT_SCORING_FUNCTIONS
    judge = judge_model or settings.llama_stack_model

    # Build scoring params dict
    scoring_params: Dict[str, Any] = {}
    for func in scoring_functions:
        if func.startswith("llm-as-judge"):
            scoring_params[func] = {"judge_model": judge}
        else:
            scoring_params[func] = None

    logger.info(
        "Running evaluation: benchmark=%s, model=%s, scoring=%s",
        benchmark_id,
        model_id,
        scoring_functions,
    )

    # If input_rows provided, use evaluate_rows
    if input_rows:
        config = EvaluationConfig(model_id=model_id)
        return evaluate_rows(
            client,
            benchmark_id,
            input_rows[:num_examples] if num_examples else input_rows,
            config,
            scoring_functions,
        )

    # Otherwise, run via eval.run_eval (requires benchmark with dataset)
    try:
        benchmark_config: Dict[str, Any] = {
            "candidate": {
                "type": "model",
                "model": model_id,
                "sampling_params": {"strategy": {"type": "greedy"}},
            },
            "scoring_functions": scoring_functions,
        }
        if num_examples:
            benchmark_config["num_examples"] = num_examples

        eval_job = client.eval.run_eval(
            benchmark_id=benchmark_id,
            benchmark_config=benchmark_config,
        )

        # Get results
        result = client.eval.job_result(
            benchmark_id=benchmark_id,
            job_id=eval_job.job_id,
        )

        scores = {}
        if hasattr(result, "aggregated_scores"):
            scores = dict(result.aggregated_scores)

        return EvaluationResult(
            benchmark_id=benchmark_id,
            model_id=model_id,
            scores=scores,
            raw_results=result,
            num_examples=num_examples or 0,
        )

    except Exception as e:
        logger.error("Evaluation failed: %s", e)
        return EvaluationResult(
            benchmark_id=benchmark_id,
            model_id=model_id,
            scores={},
            raw_results={"error": str(e)},
            num_examples=0,
        )


# =============================================================================
# Standalone Eval Pipeline (for make eval / CI)
# =============================================================================


@dataclass
class EvalCase:
    """A single evaluation test case.

    Attributes:
        id: Unique test case identifier
        input: Input prompt to evaluate
        reference: Optional reference output for comparison
        tags: Optional tags for filtering/grouping
    """

    id: str
    input: str
    reference: str | None = None
    tags: list[str] = field(default_factory=list)


@dataclass
class EvalCaseResult:
    """Result of evaluating a single test case.

    Attributes:
        case_id: ID of the test case
        score: Score from 1-5
        reasoning: Judge's reasoning for the score
        generated_output: The output that was evaluated
        error: Error message if evaluation failed
    """

    case_id: str
    score: float
    reasoning: str
    generated_output: str
    error: str | None = None


@dataclass
class EvalPipelineResult:
    """Result of running the full evaluation pipeline.

    Attributes:
        median_score: Median score across all test cases
        mean_score: Mean score across all test cases
        passed: Whether median >= threshold
        threshold: The threshold used for pass/fail
        scores: List of individual scores
        details: Per-case results
        timestamp: When the evaluation was run
    """

    median_score: float
    mean_score: float
    passed: bool
    threshold: float
    scores: list[float]
    details: list[EvalCaseResult]
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def summary(self) -> str:
        """Human-readable summary."""
        status = "PASSED" if self.passed else "FAILED"
        return (
            f"{status}\n"
            f"Median Score: {self.median_score:.2f} (threshold: {self.threshold})\n"
            f"Mean Score: {self.mean_score:.2f}\n"
            f"Test Cases: {len(self.scores)}\n"
            f"Score Distribution: min={min(self.scores):.1f}, max={max(self.scores):.1f}"
        )


def load_eval_dataset(path: str | Path) -> list[EvalCase]:
    """Load evaluation test cases from a JSON file.

    Supports two formats:
    1. New format: {"metadata": {...}, "test_cases": [...]}
    2. Legacy format: [{"input": "...", ...}, ...]

    Args:
        path: Path to the JSON file

    Returns:
        List of EvalCase objects

    Raises:
        FileNotFoundError: If file doesn't exist
        ValueError: If JSON is malformed
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Eval dataset not found: {path}")

    data = json.loads(path.read_text())

    # Handle new format with metadata
    if isinstance(data, dict) and "test_cases" in data:
        test_cases = data["test_cases"]
    else:
        # Legacy format: list of cases
        test_cases = data

    cases = []
    for i, tc in enumerate(test_cases):
        cases.append(
            EvalCase(
                id=tc.get("id", f"tc-{i+1:03d}"),
                input=tc.get("input", ""),
                reference=tc.get("reference") or tc.get("expected_behavior"),
                tags=tc.get("tags", []),
            )
        )

    logger.info("Loaded %d eval cases from %s", len(cases), path)
    return cases


# LLM-as-judge prompt template
JUDGE_PROMPT_TEMPLATE = """You are evaluating the quality of AI-generated video ideas.

INPUT PROMPT: {input}

GENERATED OUTPUT:
{output}

{reference_section}

Score the output from 1-5:
1 = Poor: Off-topic, incoherent, or inappropriate
2 = Below Average: Partially relevant but lacks creativity or detail
3 = Average: Meets basic requirements but nothing special
4 = Good: Creative, relevant, and well-structured
5 = Excellent: Highly creative, engaging, and perfectly suited to the request

Respond with ONLY a JSON object in this exact format:
{{"score": <number 1-5>, "reasoning": "<brief explanation>"}}
"""


def llm_judge_score(
    client: LlamaStackClient,
    input_prompt: str,
    output: str,
    reference: str | None = None,
    model_id: str | None = None,
) -> tuple[float, str]:
    """Score an output using LLM-as-judge.

    Args:
        client: Llama Stack client
        input_prompt: Original input prompt
        output: Generated output to evaluate
        reference: Optional reference for comparison
        model_id: Model to use as judge (defaults to settings)

    Returns:
        Tuple of (score, reasoning)

    Raises:
        ValueError: If response cannot be parsed
    """
    model = model_id or settings.llama_stack_model

    reference_section = ""
    if reference:
        reference_section = f"\nREFERENCE CRITERIA:\n{reference}\n"

    judge_prompt = JUDGE_PROMPT_TEMPLATE.format(
        input=input_prompt,
        output=output,
        reference_section=reference_section,
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": judge_prompt}],
        )

        # Extract content from OpenAI-compatible response
        content = ""
        if response.choices and response.choices[0].message:
            content = response.choices[0].message.content or ""
        elif isinstance(response, dict):
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")

        # Parse JSON from response
        # Try to extract JSON from potential markdown code blocks
        json_match = re.search(r'\{[^{}]*"score"[^{}]*\}', content, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
        else:
            result = json.loads(content)

        score = float(result.get("score", 3.0))
        reasoning = result.get("reasoning", "No reasoning provided")

        # Clamp score to valid range
        score = max(1.0, min(5.0, score))

        return score, reasoning

    except json.JSONDecodeError as e:
        logger.warning("Failed to parse judge response: %s", e)
        return 3.0, f"Parse error: {e}"
    except Exception as e:
        logger.error("Judge scoring failed: %s", e)
        return 3.0, f"Error: {e}"


def run_eval_pipeline(
    client: LlamaStackClient,
    cases: list[EvalCase],
    threshold: float = 3.5,
    generate_fn: Any | None = None,
    model_id: str | None = None,
) -> EvalPipelineResult:
    """Run evaluation pipeline on test cases.

    For each test case:
    1. Generate output using generate_fn (or mock if None)
    2. Score output using LLM-as-judge
    3. Aggregate results

    Args:
        client: Llama Stack client
        cases: List of test cases to evaluate
        threshold: Minimum median score to pass (default: 3.5)
        generate_fn: Function to generate output from input (optional)
                    Signature: (client, input: str) -> str
                    If None, uses a simple prompt
        model_id: Model for judge (defaults to settings)

    Returns:
        EvalPipelineResult with scores and pass/fail status
    """
    model = model_id or settings.llama_stack_model
    details: list[EvalCaseResult] = []
    scores: list[float] = []

    logger.info(
        "Running eval pipeline: %d cases, threshold=%.1f, model=%s",
        len(cases),
        threshold,
        model,
    )

    for case in cases:
        try:
            # Generate output
            if generate_fn:
                output = generate_fn(client, case.input)
            else:
                # Default: simple inference using OpenAI-compatible API
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": case.input}],
                )
                if response.choices and response.choices[0].message:
                    output = response.choices[0].message.content or ""
                else:
                    output = str(response)

            # Score output
            score, reasoning = llm_judge_score(
                client=client,
                input_prompt=case.input,
                output=output,
                reference=case.reference,
                model_id=model,
            )

            scores.append(score)
            details.append(
                EvalCaseResult(
                    case_id=case.id,
                    score=score,
                    reasoning=reasoning,
                    generated_output=output[:500],  # Truncate for storage
                    error=None,
                )
            )

            logger.info(
                "Evaluated %s: score=%.1f",
                case.id,
                score,
            )

        except Exception as e:
            logger.error("Eval failed for %s: %s", case.id, e)
            scores.append(1.0)  # Failure = minimum score
            details.append(
                EvalCaseResult(
                    case_id=case.id,
                    score=1.0,
                    reasoning="Evaluation failed",
                    generated_output="",
                    error=str(e),
                )
            )

    # Calculate aggregate metrics
    median_score = statistics.median(scores) if scores else 0.0
    mean_score = statistics.mean(scores) if scores else 0.0
    passed = median_score >= threshold

    logger.info(
        "Eval complete: median=%.2f, mean=%.2f, passed=%s",
        median_score,
        mean_score,
        passed,
    )

    return EvalPipelineResult(
        median_score=median_score,
        mean_score=mean_score,
        passed=passed,
        threshold=threshold,
        scores=scores,
        details=details,
    )
