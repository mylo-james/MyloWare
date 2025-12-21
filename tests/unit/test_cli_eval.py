"""Unit tests for eval CLI commands."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from click.testing import CliRunner

from myloware.cli.main import cli


def test_eval_setup_dataset_without_seed_file(monkeypatch, tmp_path: Path) -> None:
    calls = {}

    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())
    monkeypatch.setattr(
        "myloware.observability.datasets.register_dataset",
        lambda _client, dataset_id, rows: calls.update({"id": dataset_id, "rows": rows}),
    )
    monkeypatch.setattr("myloware.observability.datasets.append_rows", lambda *_a, **_k: None)

    seed = tmp_path / "missing.json"
    result = CliRunner().invoke(
        cli, ["eval", "setup-dataset", "--dataset-id", "ds1", "--seed", str(seed)]
    )

    assert result.exit_code == 0
    assert calls["id"] == "ds1"
    assert calls["rows"] == []


def test_eval_setup_dataset_with_seed_file_appends_rows(monkeypatch, tmp_path: Path) -> None:
    calls = {"appended": 0}
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())

    def register_dataset(_client, dataset_id, rows):
        assert dataset_id == "ds1"
        assert len(rows) == 1

    def append_rows(_client, dataset_id, rows):
        assert dataset_id == "ds1"
        assert len(rows) == 1
        calls["appended"] += 1

    monkeypatch.setattr("myloware.observability.datasets.register_dataset", register_dataset)
    monkeypatch.setattr("myloware.observability.datasets.append_rows", append_rows)

    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps([{"id": "c1", "input": "x"}]))

    result = CliRunner().invoke(
        cli, ["eval", "setup-dataset", "--dataset-id", "ds1", "--seed", str(seed)]
    )
    assert result.exit_code == 0
    assert calls["appended"] == 1


def test_eval_setup_benchmark(monkeypatch) -> None:
    calls = {}
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())
    monkeypatch.setattr(
        "myloware.observability.evaluation.register_benchmark",
        lambda _client, benchmark_id, dataset_id, scoring_functions: calls.update(
            {"benchmark_id": benchmark_id, "dataset_id": dataset_id, "scoring": scoring_functions}
        ),
    )

    result = CliRunner().invoke(
        cli,
        [
            "eval",
            "setup-benchmark",
            "--benchmark-id",
            "b1",
            "--dataset-id",
            "ds1",
            "--scoring",
            "a",
            "--scoring",
            "b",
        ],
    )
    assert result.exit_code == 0
    assert calls["benchmark_id"] == "b1"
    assert calls["dataset_id"] == "ds1"
    assert calls["scoring"] == ["a", "b"]


def test_eval_run(monkeypatch) -> None:
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())
    monkeypatch.setattr(
        "myloware.observability.evaluation.run_evaluation",
        lambda _client, benchmark_id, model_id: {"benchmark_id": benchmark_id, "model": model_id},
    )

    result = CliRunner().invoke(cli, ["eval", "run", "b1", "--model", "m1"])
    assert result.exit_code == 0
    assert "Evaluation Results for b1" in result.output
    assert '"model": "m1"' in result.output


def test_eval_score_dataset_not_found() -> None:
    result = CliRunner().invoke(cli, ["eval", "score", "--dataset", "does-not-exist.json"])
    assert result.exit_code == 1
    assert "Dataset not found" in result.output


def test_eval_score_dry_run(monkeypatch, tmp_path: Path) -> None:
    dataset = tmp_path / "cases.json"
    dataset.write_text("[]")

    Case = SimpleNamespace
    cases = [Case(id="c1", input="hello world"), Case(id="c2", input="more text")]

    monkeypatch.setattr("myloware.observability.evaluation.load_eval_dataset", lambda _p: cases)
    monkeypatch.setattr(
        "myloware.observability.evaluation.run_eval_pipeline", lambda *_a, **_k: None
    )
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())

    result = CliRunner().invoke(cli, ["eval", "score", "--dataset", str(dataset), "--dry-run"])
    assert result.exit_code == 0
    assert "Dry run" in result.output


def test_eval_score_dry_run_prints_remaining_count(monkeypatch, tmp_path: Path) -> None:
    dataset = tmp_path / "cases.json"
    dataset.write_text("[]")

    Case = SimpleNamespace
    cases = [Case(id=f"c{i}", input="x" * 10) for i in range(6)]

    monkeypatch.setattr("myloware.observability.evaluation.load_eval_dataset", lambda _p: cases)
    monkeypatch.setattr(
        "myloware.observability.evaluation.run_eval_pipeline", lambda *_a, **_k: None
    )
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())

    result = CliRunner().invoke(cli, ["eval", "score", "--dataset", str(dataset), "--dry-run"])
    assert result.exit_code == 0
    assert "... and 1 more" in result.output


def test_eval_score_load_dataset_generic_error(monkeypatch, tmp_path: Path) -> None:
    dataset = tmp_path / "cases.json"
    dataset.write_text("[]")

    def boom(_p: Path):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr("myloware.observability.evaluation.load_eval_dataset", boom)
    monkeypatch.setattr(
        "myloware.observability.evaluation.run_eval_pipeline", lambda *_a, **_k: None
    )
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())

    result = CliRunner().invoke(cli, ["eval", "score", "--dataset", str(dataset), "--dry-run"])
    assert result.exit_code == 1
    assert "Failed to load dataset" in result.output


def test_eval_score_pipeline_passes(monkeypatch, tmp_path: Path) -> None:
    dataset = tmp_path / "cases.json"
    dataset.write_text("[]")

    cases = [SimpleNamespace(id="c1", input="hello world")]

    details = [
        SimpleNamespace(case_id="c1", score=4.0, reasoning="good"),
    ]
    result_obj = SimpleNamespace(summary="ok", details=details, passed=True)

    monkeypatch.setattr("myloware.observability.evaluation.load_eval_dataset", lambda _p: cases)
    monkeypatch.setattr(
        "myloware.observability.evaluation.run_eval_pipeline", lambda **_k: result_obj
    )
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())

    result = CliRunner().invoke(
        cli, ["eval", "score", "--dataset", str(dataset), "--threshold", "3.5"]
    )
    assert result.exit_code == 0
    assert "Evaluation PASSED" in result.output


def test_eval_score_pipeline_fails(monkeypatch, tmp_path: Path) -> None:
    dataset = tmp_path / "cases.json"
    dataset.write_text("[]")

    cases = [SimpleNamespace(id="c1", input="hello world")]

    details = [
        SimpleNamespace(case_id="c1", score=1.0, reasoning="bad"),
    ]
    result_obj = SimpleNamespace(summary="nope", details=details, passed=False)

    monkeypatch.setattr("myloware.observability.evaluation.load_eval_dataset", lambda _p: cases)
    monkeypatch.setattr(
        "myloware.observability.evaluation.run_eval_pipeline", lambda **_k: result_obj
    )
    monkeypatch.setattr("myloware.cli.eval.get_sync_client", lambda: object())

    result = CliRunner().invoke(
        cli, ["eval", "score", "--dataset", str(dataset), "--threshold", "3.5"]
    )
    assert result.exit_code == 1
    assert "Evaluation FAILED" in result.output
