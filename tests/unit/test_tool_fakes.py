from __future__ import annotations

from myloware.tools.fakes import RemotionFakeClient, SoraFakeClient, UploadPostFakeClient


def test_sora_fake_client_submit_and_callback() -> None:
    client = SoraFakeClient()
    out = client.submit_job(prompt="p", run_id="r", callback_url="http://cb")

    assert out["status"] == "submitted"
    task_id = out["data"]["taskId"]
    assert task_id.startswith("fake-sora-")

    callback = client.simulate_callback(task_id)
    assert callback["status"] == "completed"
    assert callback["videoUrl"].endswith(f"{task_id}.mp4")
    assert callback["metadata"]["runId"] == "r"


def test_remotion_fake_client_submit_records_jobs() -> None:
    client = RemotionFakeClient()
    out = client.submit(
        composition_code="tsx",
        clips=["c1", "c2"],
        run_id="r",
        duration_frames=123,
    )

    assert out["status"] == "queued"
    assert out["job_id"].startswith("fake-remotion-")
    assert out["output_url"].endswith(f"{out['job_id']}.mp4")
    assert client.jobs and client.jobs[0]["duration_frames"] == 123


def test_upload_post_fake_client_publish_records_posts() -> None:
    client = UploadPostFakeClient()
    out = client.publish(video_url="v", caption="c", hashtags=["h"], run_id="r")

    assert out["status"] == "published"
    assert out["post_id"].startswith("fake-upload-")
    assert out["url"].endswith(out["post_id"])
    assert client.posts and client.posts[0]["video_url"] == "v"
