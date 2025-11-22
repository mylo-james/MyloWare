from __future__ import annotations

import json

import core.runs.schema as schema


def test_build_graph_spec_deduplicates_and_preserves_order() -> None:
    result = schema.build_graph_spec(
        pipeline=["brendan", "iggy", "iggy", "riley"],
        hitl_gates=["ideate", "ideate", "prepublish"],
    )
    assert result["pipeline"] == ["brendan", "iggy", "riley"]
    assert result["hitl_gates"] == ["ideate", "prepublish"]


def test_build_run_payload_serializable_and_complete() -> None:
    graph_spec = schema.build_graph_spec(
        pipeline=["iggy", "riley", "alex", "quinn"],
        hitl_gates=["after_iggy", "before_quinn"],
    )
    payload = schema.build_run_payload(
        project="test_video_gen",
        run_input={"prompt": "smoke"},
        graph_spec=graph_spec,
        user_id="telegram_123",
        options={"mode": "mock"},
        metadata={"project_spec_version": "2025-11-14"},
    )
    assert payload["project"] == "test_video_gen"
    assert payload["user_id"] == "telegram_123"
    assert payload["graph_spec"] == graph_spec
    assert payload["options"] == {"mode": "mock"}
    assert payload["metadata"] == {"project_spec_version": "2025-11-14"}
    # Ensure JSON serialization succeeds
    assert json.loads(json.dumps(payload)) == payload


def test_build_run_result_has_expected_fields() -> None:
    result = schema.build_run_result(
        status="pending",
        publish_urls=["https://example/video"],
        extra={"notes": "demo"},
    )
    assert result["status"] == "pending"
    assert result["publish_urls"] == ["https://example/video"]
    assert result["extra"] == {"notes": "demo"}
