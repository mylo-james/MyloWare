from __future__ import annotations

import textwrap

import pytest

from scripts.dev import check_slos


PASSING_METRICS = textwrap.dedent(
    """
    # HELP http_request_duration_seconds request latency
    http_request_duration_seconds_bucket{handler="/v1/chat/brendan",method="POST",le="0.1"} 5
    http_request_duration_seconds_bucket{handler="/v1/chat/brendan",method="POST",le="0.5"} 10
    http_request_duration_seconds_bucket{handler="/v1/chat/brendan",method="POST",le="1"} 19
    http_request_duration_seconds_bucket{handler="/v1/chat/brendan",method="POST",le="2"} 20
    http_request_duration_seconds_bucket{handler="/v1/chat/brendan",method="POST",le="+Inf"} 20
    http_request_duration_seconds_count{handler="/v1/chat/brendan",method="POST"} 20
    http_request_duration_seconds_sum{handler="/v1/chat/brendan",method="POST"} 12

    # HELP kb_search_seconds retrieval latency
    kb_search_seconds_bucket{project="aismr",persona="iggy",le="0.05"} 5
    kb_search_seconds_bucket{project="aismr",persona="iggy",le="0.25"} 15
    kb_search_seconds_bucket{project="aismr",persona="iggy",le="0.5"} 20
    kb_search_seconds_bucket{project="aismr",persona="iggy",le="+Inf"} 20
    kb_search_seconds_count{project="aismr",persona="iggy"} 20

    # HELP mock_publish_seconds mock pipeline latency
    mock_publish_seconds_bucket{project="test_video_gen",le="5"} 2
    mock_publish_seconds_bucket{project="test_video_gen",le="15"} 4
    mock_publish_seconds_bucket{project="test_video_gen",le="30"} 5
    mock_publish_seconds_bucket{project="test_video_gen",le="+Inf"} 5
    mock_publish_seconds_count{project="test_video_gen"} 5
    """
)


FAILING_METRICS = textwrap.dedent(
    """
    http_request_duration_seconds_bucket{handler="/v1/chat/brendan",method="POST",le="10"} 1
    http_request_duration_seconds_bucket{handler="/v1/chat/brendan",method="POST",le="+Inf"} 1
    http_request_duration_seconds_count{handler="/v1/chat/brendan",method="POST"} 1
    mock_publish_seconds_bucket{project="aismr",le="60"} 1
    mock_publish_seconds_bucket{project="aismr",le="+Inf"} 1
    mock_publish_seconds_count{project="aismr"} 1
    """
)


def test_evaluate_slo_targets_pass() -> None:
    store = check_slos.MetricsStore()
    store.ingest_metrics(PASSING_METRICS)
    targets = [
        check_slos.SLOTarget(
            name="Chat latency",
            metric="http_request_duration_seconds",
            quantile=0.95,
            threshold=2.0,
            label_options=[{"handler": "/v1/chat/brendan"}],
        ),
        check_slos.SLOTarget(
            name="Retrieval latency",
            metric="kb_search_seconds",
            quantile=0.95,
            threshold=0.5,
            label_options=[{"project": "aismr"}],
        ),
        check_slos.SLOTarget(
            name="Mock publish latency",
            metric="mock_publish_seconds",
            quantile=0.95,
            threshold=30.0,
            label_options=[{"project": "test_video_gen"}],
        ),
    ]

    results = check_slos.evaluate_slo_targets(store, targets)
    assert all(result.passed for result in results)
    observed = {result.target.name: result.observed for result in results}
    assert observed["Chat latency"] is not None
    assert observed["Chat latency"] < 2.0


def test_evaluate_slo_targets_handles_missing_histogram() -> None:
    store = check_slos.MetricsStore()
    store.ingest_metrics("# empty")
    target = check_slos.SLOTarget(
        name="Missing metric",
        metric="kb_search_seconds",
        quantile=0.95,
        threshold=0.5,
        label_options=[{"project": "aismr"}],
    )
    result = check_slos.evaluate_slo_targets(store, [target])[0]
    assert result.passed is False
    assert "missing" in result.message.lower()


def test_evaluate_slo_targets_failure_message() -> None:
    store = check_slos.MetricsStore()
    store.ingest_metrics(FAILING_METRICS)
    target = check_slos.SLOTarget(
        name="Chat latency",
        metric="http_request_duration_seconds",
        quantile=0.95,
        threshold=2.0,
        label_options=[{"handler": "/v1/chat/brendan"}],
    )
    result = check_slos.evaluate_slo_targets(store, [target])[0]
    assert result.passed is False
    assert result.observed is not None
    assert "exceeds" in result.message.lower()
