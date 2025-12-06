"""Llama Stack evaluation integration.

Note: API changed significantly in 0.3.x. The `eval.run_eval` endpoint
is no longer available. Evaluation now uses `benchmarks` and `scoring` APIs.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from llama_stack_client import LlamaStackClient

from config import settings

logger = logging.getLogger("observability.evaluation")

__all__ = ["get_scoring_functions", "register_benchmark", "run_evaluation"]

DEFAULT_SCORING_FUNCTIONS: list[str] = ["llm-as-judge::quality"]


def get_scoring_functions() -> list[str]:
    """Return available scoring functions used by the evaluation pipeline."""

    return DEFAULT_SCORING_FUNCTIONS.copy()


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
        scoring_functions: List of scoring function IDs (default: llm-as-judge::quality)
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


def run_evaluation(
    client: LlamaStackClient,
    benchmark_id: str,
    model_id: str,
    scoring_functions: list[str] | None = None,
    judge_model: str | None = None,
) -> Any:
    """
    Run evaluation on a benchmark.

    Note: In Llama Stack 0.3.x, the eval.run_eval endpoint has been removed.
    This function is a placeholder that needs to be updated when the new
    evaluation API is documented.

    Args:
        client: Llama Stack client
        benchmark_id: ID of the benchmark to run
        model_id: ID of the model to evaluate
        scoring_functions: Optional list of scoring functions
        judge_model: Optional judge model for LLM-as-judge scoring

    Returns:
        Evaluation results (structure depends on implementation)
    """
    scoring_functions = scoring_functions or DEFAULT_SCORING_FUNCTIONS
    judge = judge_model or settings.llama_stack_model

    logger.warning(
        "run_evaluation is not fully implemented for Llama Stack 0.3.x API. "
        "Benchmark: %s, Model: %s",
        benchmark_id,
        model_id,
    )

    # TODO: Implement evaluation with new scoring API
    # The new API uses client.scoring.score() and client.scoring.score_batch()
    # but requires a different input format than the old eval.run_eval()

    return {
        "benchmark_id": benchmark_id,
        "model_id": model_id,
        "scoring_functions": scoring_functions,
        "judge_model": judge,
        "status": "not_implemented",
        "message": "Evaluation API changed in 0.3.x - implementation pending",
    }
