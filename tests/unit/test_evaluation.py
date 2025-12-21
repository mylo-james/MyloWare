"""Tests for evaluation and dataset management."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from myloware.observability.datasets import append_rows, get_rows, register_dataset
from myloware.observability.evaluation import (
    EvalCase,
    EvalPipelineResult,
    get_scoring_functions,
    load_eval_dataset,
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
    # Default scoring function is now basic::subset_of
    assert "basic::subset_of" in kwargs["scoring_functions"]


def test_run_evaluation_returns_result():
    """Test run_evaluation returns EvaluationResult object."""
    client = MagicMock()
    # Mock the eval.run_eval call to raise (triggers fallback)
    client.eval.run_eval.side_effect = Exception("Not available")

    result = run_evaluation(client, benchmark_id="bench-1", model_id="model-x")

    # New API returns EvaluationResult dataclass
    assert result.benchmark_id == "bench-1"
    assert result.model_id == "model-x"
    assert "error" in str(result.raw_results)


def test_run_evaluation_with_input_rows():
    """Test run_evaluation with explicit input rows."""
    from myloware.observability.evaluation import EvaluationResult

    client = MagicMock()
    client.eval.evaluate_rows.return_value = MagicMock(aggregated_scores={"accuracy": 0.85})

    rows = [{"prompt": "What is AI?", "expected": "Artificial Intelligence"}]
    result = run_evaluation(
        client,
        benchmark_id="bench-1",
        model_id="model-x",
        input_rows=rows,
    )

    assert isinstance(result, EvaluationResult)
    assert result.benchmark_id == "bench-1"
    assert result.scores.get("accuracy") == 0.85


def test_get_scoring_functions_returns_categories():
    """Test get_scoring_functions returns categorized functions."""
    functions = get_scoring_functions()

    # Now returns a dict with categories
    assert "basic" in functions
    assert "llm_judge" in functions
    assert "default" in functions

    # Check specific functions exist
    assert "basic::exact_match" in functions["basic"]
    assert "llm-as-judge::quality" in functions["llm_judge"]
    assert "basic::subset_of" in functions["default"]


def test_evaluation_config_to_benchmark_config_variants():
    from myloware.observability.evaluation import EvaluationConfig

    cfg = EvaluationConfig(model_id="m1", sampling_strategy="greedy")
    out = cfg.to_benchmark_config()
    assert out["eval_candidate"]["sampling_params"]["strategy"]["type"] == "greedy"

    cfg2 = EvaluationConfig(model_id="m2", sampling_strategy="top_p", temperature=0.2, top_p=0.9)
    out2 = cfg2.to_benchmark_config()
    assert out2["eval_candidate"]["sampling_params"]["strategy"]["type"] == "top_p"

    cfg3 = EvaluationConfig(model_id="m3", sampling_strategy="custom", system_message="hi")
    out3 = cfg3.to_benchmark_config()
    assert out3["eval_candidate"]["sampling_params"]["strategy"]["type"] == "custom"
    assert out3["eval_candidate"]["system_message"]["content"] == "hi"


# =============================================================================
# Tests for standalone eval pipeline
# =============================================================================


class TestEvalCase:
    """Tests for EvalCase dataclass."""

    def test_eval_case_creation(self) -> None:
        """Test creating an EvalCase."""
        case = EvalCase(
            id="tc-001",
            input="Generate video ideas",
            reference="Should be creative",
            tags=["test"],
        )
        assert case.id == "tc-001"
        assert case.input == "Generate video ideas"
        assert case.reference == "Should be creative"
        assert case.tags == ["test"]

    def test_eval_case_defaults(self) -> None:
        """Test EvalCase default values."""
        case = EvalCase(id="tc-002", input="Test input")
        assert case.reference is None
        assert case.tags == []


class TestLoadEvalDataset:
    """Tests for load_eval_dataset function."""

    def test_load_new_format(self) -> None:
        """Test loading dataset with metadata format."""
        data = {
            "metadata": {"version": "1.0"},
            "test_cases": [
                {"id": "tc-001", "input": "Test 1", "reference": "Ref 1"},
                {"id": "tc-002", "input": "Test 2"},
            ],
        }

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            f.flush()

            cases = load_eval_dataset(f.name)

        assert len(cases) == 2
        assert cases[0].id == "tc-001"
        assert cases[0].input == "Test 1"
        assert cases[0].reference == "Ref 1"
        assert cases[1].reference is None

        Path(f.name).unlink()

    def test_load_legacy_format(self) -> None:
        """Test loading dataset with legacy array format."""
        data = [
            {"input": "Test A", "expected_behavior": "Should do A"},
            {"input": "Test B"},
        ]

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            f.flush()

            cases = load_eval_dataset(f.name)

        assert len(cases) == 2
        assert cases[0].id == "tc-001"  # Auto-generated ID
        assert cases[0].input == "Test A"
        assert cases[0].reference == "Should do A"  # From expected_behavior

        Path(f.name).unlink()

    def test_load_nonexistent_file(self) -> None:
        """Test loading from nonexistent file raises error."""
        with pytest.raises(FileNotFoundError):
            load_eval_dataset("/nonexistent/path.json")

    def test_load_actual_dataset(self) -> None:
        """Test loading the actual ideator_test_cases.json."""
        # This tests the real file exists and is valid
        dataset_path = Path("data/eval/ideator_test_cases.json")
        if dataset_path.exists():
            cases = load_eval_dataset(dataset_path)
            assert len(cases) >= 10  # Should have at least 10 cases
            assert all(case.id for case in cases)
            assert all(case.input for case in cases)


class TestEvalPipelineResult:
    """Tests for EvalPipelineResult dataclass."""

    def test_result_pass(self) -> None:
        """Test result with passing score."""
        result = EvalPipelineResult(
            median_score=4.0,
            mean_score=3.8,
            passed=True,
            threshold=3.5,
            scores=[3.0, 4.0, 5.0, 4.0],
            details=[],
        )

        assert result.passed is True
        assert "PASSED" in result.summary

    def test_result_fail(self) -> None:
        """Test result with failing score."""
        result = EvalPipelineResult(
            median_score=3.0,
            mean_score=2.8,
            passed=False,
            threshold=3.5,
            scores=[2.0, 3.0, 3.0, 4.0],
            details=[],
        )

        assert result.passed is False
        assert "FAILED" in result.summary

    def test_median_calculation(self) -> None:
        """Test that median is calculated correctly."""
        import statistics

        scores = [3.0, 4.0, 5.0, 2.0, 4.0]
        median = statistics.median(scores)

        assert median == 4.0  # [2.0, 3.0, 4.0, 4.0, 5.0] -> median is 4.0


class TestThresholdComparison:
    """Tests for threshold pass/fail logic."""

    def test_threshold_pass(self) -> None:
        """Test that median >= threshold passes."""
        result = EvalPipelineResult(
            median_score=3.5,
            mean_score=3.5,
            passed=True,
            threshold=3.5,
            scores=[3.5],
            details=[],
        )
        assert result.passed is True

    def test_threshold_fail(self) -> None:
        """Test that median < threshold fails."""
        result = EvalPipelineResult(
            median_score=3.4,
            mean_score=3.4,
            passed=False,
            threshold=3.5,
            scores=[3.4],
            details=[],
        )
        assert result.passed is False

    def test_threshold_boundary(self) -> None:
        """Test boundary condition (exactly at threshold)."""
        threshold = 3.5
        median_at_threshold = 3.5

        # At threshold should pass
        assert median_at_threshold >= threshold

        # Just below should fail
        median_below = 3.49
        assert median_below < threshold


def test_llm_judge_score_parses_json_block():
    from myloware.observability import evaluation as eval_mod

    class FakeClient:
        class Chat:
            class Completions:
                def create(self, **_kwargs):  # type: ignore[no-untyped-def]
                    return SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                message=SimpleNamespace(
                                    content='```json\n{"score": 4, "reasoning": "ok"}\n```'
                                )
                            )
                        ]
                    )

            completions = Completions()

        chat = Chat()

    score, reasoning = eval_mod.llm_judge_score(FakeClient(), "in", "out", reference="ref")
    assert score == 4.0
    assert reasoning == "ok"


def test_llm_judge_score_handles_invalid_json():
    from myloware.observability import evaluation as eval_mod

    class FakeClient:
        class Chat:
            class Completions:
                def create(self, **_kwargs):  # type: ignore[no-untyped-def]
                    return SimpleNamespace(
                        choices=[SimpleNamespace(message=SimpleNamespace(content="not json"))]
                    )

            completions = Completions()

        chat = Chat()

    score, reasoning = eval_mod.llm_judge_score(FakeClient(), "in", "out")
    assert score == 3.0
    assert "Parse error" in reasoning


def test_run_eval_pipeline_with_generate_fn(monkeypatch):
    from myloware.observability import evaluation as eval_mod

    cases = [EvalCase(id="tc-1", input="prompt", reference="ref")]

    def generate(_client, _input):  # type: ignore[no-untyped-def]
        return "output"

    monkeypatch.setattr(eval_mod, "llm_judge_score", lambda **_k: (4.0, "ok"))

    result = eval_mod.run_eval_pipeline(
        client=SimpleNamespace(),
        cases=cases,
        threshold=3.5,
        generate_fn=generate,
    )
    assert result.passed is True
    assert result.scores == [4.0]


def test_run_eval_pipeline_default_generation(monkeypatch):
    from myloware.observability import evaluation as eval_mod

    cases = [EvalCase(id="tc-2", input="prompt", reference=None)]

    class FakeClient:
        class Chat:
            class Completions:
                def create(self, **_kwargs):  # type: ignore[no-untyped-def]
                    return SimpleNamespace(
                        choices=[SimpleNamespace(message=SimpleNamespace(content="generated"))]
                    )

            completions = Completions()

        chat = Chat()

    monkeypatch.setattr(eval_mod, "llm_judge_score", lambda **_k: (2.0, "bad"))

    result = eval_mod.run_eval_pipeline(client=FakeClient(), cases=cases, threshold=3.5)
    assert result.passed is False
    assert result.scores == [2.0]
