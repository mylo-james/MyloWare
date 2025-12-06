"""Tests for fake provider clients and factory selection."""

from unittest.mock import patch

from tools.fakes import (
    KIEFakeClient,
    RemotionFakeClient,
    UploadPostFakeClient,
)


def test_kie_fake_tracks_jobs():
    client = KIEFakeClient()

    resp = client.submit_job(prompt="test", run_id="run-1", callback_url="http://cb")
    assert resp["status"] == "submitted"
    assert len(client.submitted_jobs) == 1
    cb = client.simulate_callback(resp["data"]["taskId"])
    assert cb["status"] == "completed"


def test_remotion_fake_tracks_jobs():
    client = RemotionFakeClient()
    resp = client.submit(
        composition_code="export const RemotionComposition = () => null;",
        clips=["https://clip"],
        run_id="run-4",
        duration_frames=120,
    )
    assert resp["status"] == "queued"
    assert len(client.jobs) == 1


def test_upload_post_fake_tracks_posts():
    client = UploadPostFakeClient()
    resp = client.publish(
        video_url="https://video.mp4", caption="hi", hashtags=["a"], run_id="run-3"
    )
    assert resp["status"] == "published"
    assert len(client.posts) == 1


def test_factory_returns_fakes_when_enabled():
    from tools import factory

    with patch.object(factory, "settings") as mock_settings:
        mock_settings.use_fake_providers = True

        assert isinstance(factory.get_kie_client(), KIEFakeClient)
        assert isinstance(factory.get_remotion_client(), RemotionFakeClient)
        assert isinstance(factory.get_upload_post_client(), UploadPostFakeClient)
