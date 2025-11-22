from __future__ import annotations

from tests.integration.python_orchestrator.mock_e2e_harness import MockGraphHarness


def _video_specs() -> list[dict[str, object]]:
    return [
        {"index": 0, "subject": "moon", "header": "cheeseburger", "prompt": "Moon dancing", "duration": 8},
        {"index": 1, "subject": "sun", "header": "pickle", "prompt": "Sun spinning", "duration": 8},
    ]


def test_mocked_test_video_gen_run(monkeypatch: "pytest.MonkeyPatch", tmp_path):
    harness = MockGraphHarness(
        project="test_video_gen",
        run_id="run-tvg-mock",
        videos=_video_specs(),
        caption="Two clip compilation",
        prompt="Create two surreal clips",
    )
    harness.apply_patches(monkeypatch, tmp_path)

    final_state = harness.run_graph()

    assert harness.executed_personas == ["iggy", "riley", "alex", "quinn"], "Graph should traverse the persona pipeline"

    assert final_state["publishUrls"], "Quinn should produce publish URLs"
    assert harness.published_urls() == final_state["publishUrls"]

    videos = harness.run_videos()
    assert len(videos) == 2
    assert all(video.get("status") == "generated" for video in videos)

    required_artifacts = {
        "kieai.job",
        "kieai.wait",
        "shotstack.timeline",
        "render.url",
        "publish.url",
    }
    assert required_artifacts.issubset(harness.artifact_types())
    assert harness.tool_usage["submit_generation_jobs_tool"] == 1
    assert harness.tool_usage["wait_for_generations_tool"] == 1
    assert harness.tool_usage["render_video_timeline_tool"] == 1
    assert harness.tool_usage["publish_to_tiktok_tool"] == 1

    artifacts = list(harness.db.artifacts)

    kieai_jobs = [artifact for artifact in artifacts if artifact["artifact_type"] == "kieai.job"]
    assert len(kieai_jobs) == 2
    assert all(artifact["persona"] == "riley" for artifact in kieai_jobs)

    kieai_waits = [artifact for artifact in artifacts if artifact["artifact_type"] == "kieai.wait"]
    assert kieai_waits, "wait_for_generations_tool should record wait artifacts"
    assert all(artifact["persona"] == "riley" for artifact in kieai_waits)

    timeline_artifacts = [artifact for artifact in artifacts if artifact["artifact_type"] == "shotstack.timeline"]
    assert timeline_artifacts, "Alex must emit a Shotstack timeline artifact"
    assert all(artifact["persona"] == "alex" for artifact in timeline_artifacts)

    render_url_artifacts = [artifact for artifact in artifacts if artifact["artifact_type"] == "render.url"]
    assert render_url_artifacts and all(artifact["persona"] == "alex" for artifact in render_url_artifacts)

    publish_artifacts = [artifact for artifact in artifacts if artifact["artifact_type"] == "publish.url"]
    assert publish_artifacts and all(artifact["persona"] == "quinn" for artifact in publish_artifacts)
    run_record = harness.db.get_run(harness.run_id)
    assert (run_record or {}).get("result", {}).get("publishUrls") == final_state["publishUrls"]

    artifact_types = [artifact["artifact_type"] for artifact in artifacts]
    last_wait_index = max(idx for idx, name in enumerate(artifact_types) if name == "kieai.wait")
    first_timeline_index = min(idx for idx, name in enumerate(artifact_types) if name == "shotstack.timeline")
    assert last_wait_index < first_timeline_index, "Shotstack timeline must be recorded after Riley finishes waiting"
