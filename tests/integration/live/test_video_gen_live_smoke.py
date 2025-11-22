"""Opt-in live smoke test for the Test Video Gen pipeline.

This test exercises the real providers end-to-end and is **skipped by default**.
Run it only when you have:

1. `PROVIDERS_MODE=live` in the environment so adapters use real clients.
2. Real provider credentials + webhook tunnel configured.
3. `LIVE_SMOKE=1` (or `REAL_PROVIDERS=1` for backward compatibility).

It starts a `test_video_gen` run, waits for completion, and verifies
artifacts/publish URLs in Postgres.
"""
from __future__ import annotations

import os
import time

import pytest

LIVE_FLAGS = ("LIVE_SMOKE", "REAL_PROVIDERS")


def _is_live_smoke_enabled() -> bool:
    return any(os.getenv(flag, "").strip() == "1" for flag in LIVE_FLAGS)


pytestmark = [
    pytest.mark.live_smoke,
    pytest.mark.skipif(
        not _is_live_smoke_enabled(),
        reason="LIVE_SMOKE=1 (or REAL_PROVIDERS=1) required for live smoke tests",
    ),
]


@pytest.fixture
def real_provider_env() -> dict[str, str]:
    """Ensure required env vars are present before running the smoke test."""

    required = [
        "KIEAI_API_KEY",
        "SHOTSTACK_API_KEY",
        "UPLOAD_POST_API_KEY",
        "WEBHOOK_BASE_URL",
        "DB_URL",
    ]
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        pytest.skip(f"Missing required env vars: {', '.join(missing)}")
    providers_mode = os.getenv("PROVIDERS_MODE", "mock").lower()
    if providers_mode != "live":
        pytest.skip("Set PROVIDERS_MODE=live to exercise real providers")
    return {key: os.getenv(key, "") for key in required}


def test_test_video_gen_live_smoke(real_provider_env: dict[str, str]) -> None:
    """Exercise test_video_gen with live providers and verify publish URLs."""

    from apps.api.deps import get_video_gen_service  # import lazily to honor env
    from apps.api.storage import Database

    service = get_video_gen_service()
    db = Database(real_provider_env["DB_URL"])

    run_result = service.start_run(
        project="test_video_gen",
        run_input={"prompt": "Live provider smoke test"},
    )

    run_id = run_result["run_id"]
    assert run_id, "Run id should be present"

    max_wait_seconds = int(os.getenv("LIVE_SMOKE_MAX_WAIT", "900"))
    poll_interval = int(os.getenv("LIVE_SMOKE_POLL_SECONDS", "5"))
    deadline = time.time() + max_wait_seconds

    while time.time() < deadline:
        run = db.get_run(run_id)
        if not run:
            pytest.fail(f"Run {run_id} not found in database")
        status = run.get("status")
        if status == "published":
            break
        if status == "error":
            result = run.get("result") or {}
            pytest.fail(f"Run {run_id} failed: {result.get('error')}")
        time.sleep(poll_interval)
    else:
        pytest.fail(
            f"Run {run_id} did not reach published within {max_wait_seconds} seconds",
        )

    final_run = db.get_run(run_id)
    assert final_run, f"Run {run_id} should exist at completion"
    assert final_run.get("status") == "published", final_run.get("status")

    artifacts = db.list_artifacts(run_id)
    artifact_types = {artifact.get("type") for artifact in artifacts}
    expected_types = {
        "run.start",
        "kieai.job",
        "shotstack.timeline",
        "video.normalized",
        "publish.url",
    }
    missing = expected_types - artifact_types
    assert not missing, f"Missing artifact types: {sorted(missing)}"

    publish_artifacts = [a for a in artifacts if a.get("type") == "publish.url"]
    assert publish_artifacts, "Publish artifacts should be present"
    publish_urls = [a.get("url") for a in publish_artifacts if a.get("url")]
    assert publish_urls and all(url.startswith("http") for url in publish_urls)

    result = final_run.get("result") or {}
    assert result.get("publishUrls"), "Result should include publish URLs"
    assert len(result["publishUrls"]) == len(publish_urls)

