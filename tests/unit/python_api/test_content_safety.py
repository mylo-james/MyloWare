from __future__ import annotations

from apps.api.content_safety import evaluate_content_safety
def test_evaluate_content_safety_flags_unsafe_content() -> None:
    result = {
        "videos": [{"index": 0, "header": "This is forbidden footage"}],
        "publishUrls": ["https://mock.video.myloware.com/run-1-0"],
    }
    safety = evaluate_content_safety(result)
    assert safety["flagged"] is True
    assert safety["allowed"] is False


def test_evaluate_content_safety_allows_innocuous_content() -> None:
    result = {
        "videos": [{"index": 0, "header": "A calm study of pottery"}],
        "publishUrls": [],
    }
    safety = evaluate_content_safety(result)
    assert safety["flagged"] is False
    assert safety["allowed"] is True
