"""Ensure artifacts schema stays non-vector (text/URI only)."""

from myloware.storage.models import ArtifactType


def test_artifact_types_no_embedding():
    disallowed = {"embedding", "embeddings", "vector"}
    assert disallowed.isdisjoint({t.value for t in ArtifactType})
