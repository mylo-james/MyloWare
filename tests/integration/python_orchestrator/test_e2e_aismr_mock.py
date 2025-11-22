from __future__ import annotations

from tests.integration.python_orchestrator.mock_e2e_harness import MockGraphHarness


def _video_specs(count: int = 3) -> list[dict[str, object]]:
    return [
        {
            "index": idx,
            "subject": f"object-{idx}",
            "header": f"modifier-{idx}",
            "prompt": f"Object {idx} in impossible scene",
            "duration": 8,
        }
        for idx in range(count)
    ]


def test_mocked_aismr_run(monkeypatch: "pytest.MonkeyPatch", tmp_path):
    harness = MockGraphHarness(
        project="aismr",
        run_id="run-aismr-mock",
        videos=_video_specs(),
        caption="AISMR compilation",
        prompt="Create AISMR object vignettes",
    )
    harness.apply_patches(monkeypatch, tmp_path)

    final_state = harness.run_graph()

    assert harness.executed_personas == ["iggy", "riley", "alex", "quinn"]

    assert final_state["publishUrls"], "Quinn should emit publish URLs"
    assert len(final_state.get("scripts", [])) == len(harness.run_videos())
    assert final_state.get("renders"), "Alex should attach render metadata"

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
