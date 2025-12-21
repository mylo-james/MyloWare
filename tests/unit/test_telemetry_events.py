"""Unit tests for telemetry event logging helpers."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4


def test_log_workflow_event_includes_optional_fields_and_truncates_error(monkeypatch) -> None:
    from myloware.telemetry import events as mod

    fixed_ts = "2025-01-01T00:00:00+00:00"
    monkeypatch.setattr(mod, "_get_timestamp", lambda: fixed_ts)

    info = MagicMock()
    monkeypatch.setattr(mod, "logger", MagicMock(info=info))

    run_id = uuid4()
    long_error = "x" * 800
    mod.log_workflow_event(
        client=MagicMock(),
        event=mod.WorkflowEvent.FAILED,
        run_id=run_id,
        workflow="aismr",
        step="ideator",
        error=long_error,
        duration_ms=123,
        extra={"k": "v"},
    )

    info.assert_called_once()
    _msg, kwargs = info.call_args.args[0], info.call_args.kwargs
    assert _msg == "workflow_event"
    assert kwargs["run_id"] == str(run_id)
    assert kwargs["event_type"] == "workflow"
    assert kwargs["event_name"] == mod.WorkflowEvent.FAILED.value
    assert kwargs["timestamp"] == fixed_ts
    assert kwargs["workflow"] == "aismr"
    assert kwargs["step"] == "ideator"
    assert kwargs["duration_ms"] == 123
    assert kwargs["k"] == "v"
    assert kwargs["error"] == long_error[:500]


def test_log_video_generation_event_calculates_new_clips(monkeypatch) -> None:
    from myloware.telemetry import events as mod

    monkeypatch.setattr(mod, "_get_timestamp", lambda: "ts")
    info = MagicMock()
    monkeypatch.setattr(mod, "logger", MagicMock(info=info))

    run_id = uuid4()
    mod.log_video_generation_event(
        client=MagicMock(),
        run_id=run_id,
        clip_count=10,
        provider="openai sora",
        estimated_cost_usd=1.23,
        cached_clips=4,
        topic="puppies",
    )

    info.assert_called_once()
    kwargs = info.call_args.kwargs
    assert kwargs["event_type"] == "video_generation"
    assert kwargs["clip_count"] == 10
    assert kwargs["cached_clips"] == 4
    assert kwargs["new_clips"] == 6
    assert kwargs["estimated_cost_usd"] == 1.23
    assert kwargs["topic"] == "puppies"


def test_log_hitl_event_truncates_modifications(monkeypatch) -> None:
    from myloware.telemetry import events as mod

    monkeypatch.setattr(mod, "_get_timestamp", lambda: "ts")
    info = MagicMock()
    monkeypatch.setattr(mod, "logger", MagicMock(info=info))

    run_id = uuid4()
    mod.log_hitl_event(
        client=MagicMock(),
        run_id=run_id,
        gate="ideation",
        action="modified",
        user_id="u1",
        wait_time_ms=555,
        modifications="m" * 500,
    )

    info.assert_called_once()
    kwargs = info.call_args.kwargs
    assert kwargs["event_type"] == "hitl"
    assert kwargs["event_name"] == "hitl_modified"
    assert kwargs["gate"] == "ideation"
    assert kwargs["action"] == "modified"
    assert kwargs["user_id"] == "u1"
    assert kwargs["wait_time_ms"] == 555
    assert kwargs["modifications"] == ("m" * 200)


def test_log_cost_event_merges_details(monkeypatch) -> None:
    from myloware.telemetry import events as mod

    monkeypatch.setattr(mod, "_get_timestamp", lambda: "ts")
    info = MagicMock()
    monkeypatch.setattr(mod, "logger", MagicMock(info=info))

    run_id = uuid4()
    mod.log_cost_event(
        client=MagicMock(),
        run_id=run_id,
        service="openai sora",
        cost_usd=0.12,
        operation="video_generation",
        details={"extra_key": "extra_val"},
    )

    info.assert_called_once()
    kwargs = info.call_args.kwargs
    assert kwargs["event_type"] == "cost"
    assert kwargs["service"] == "openai sora"
    assert kwargs["cost_usd"] == 0.12
    assert kwargs["operation"] == "video_generation"
    assert kwargs["extra_key"] == "extra_val"
