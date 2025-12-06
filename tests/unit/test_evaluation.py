"""Tests for evaluation and dataset management."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from observability.datasets import append_rows, get_rows, register_dataset
from observability.evaluation import (
    get_scoring_functions,
    register_benchmark,
    run_evaluation,
)


def test_register_dataset_uses_source_rows():
    client = MagicMock()
    register_dataset(client, dataset_id="test-ds", rows=[{"input": "hi"}])

    client.datasets.register.assert_called_once()
    kwargs = client.datasets.register.call_args.kwargs
    assert kwargs["dataset_id"] == "test-ds"
    assert kwargs["purpose"] == "eval/question-answer"
    assert kwargs["source"]["type"] == "rows"
    assert kwargs["source"]["rows"][0]["input"] == "hi"


def test_append_rows_uses_datasetio_when_available():
    client = MagicMock()
    client.datasetio = MagicMock()
    append_rows(client, dataset_id="test-ds", rows=[{"input": "row"}])

    client.datasetio.append_rows.assert_called_once_with(
        dataset_id="test-ds", rows=[{"input": "row"}]
    )


def test_get_rows_returns_list():
    client = MagicMock()
    client.datasets.iterrows.return_value = SimpleNamespace(rows=[{"input": "x"}])

    rows = get_rows(client, dataset_id="test-ds", limit=5)

    client.datasets.iterrows.assert_called_once()
    assert rows == [{"input": "x"}]


def test_register_benchmark_calls_client():
    client = MagicMock()

    register_benchmark(client, benchmark_id="bench-1", dataset_id="ds-1")

    client.benchmarks.register.assert_called_once()
    kwargs = client.benchmarks.register.call_args.kwargs
    assert kwargs["benchmark_id"] == "bench-1"
    assert kwargs["dataset_id"] == "ds-1"
    assert "llm-as-judge::quality" in kwargs["scoring_functions"]


def test_run_evaluation_returns_status():
    """Test run_evaluation returns status dict (API changed in 0.3.x)."""
    client = MagicMock()

    result = run_evaluation(client, benchmark_id="bench-1", model_id="model-x")

    # New API returns a status dict indicating implementation pending
    assert result["benchmark_id"] == "bench-1"
    assert result["model_id"] == "model-x"
    assert result["status"] == "not_implemented"


def test_get_scoring_functions_contains_quality():
    functions = get_scoring_functions()
    assert "llm-as-judge::quality" in functions
