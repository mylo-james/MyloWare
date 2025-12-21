"""Unit tests for Upload-Post polling helpers."""

from unittest.mock import AsyncMock, Mock, patch

import pytest

from myloware.workflows.langgraph import nodes


def test_extract_upload_post_urls_from_results() -> None:
    payload = {
        "status": "completed",
        "results": [{"platform": "tiktok", "post_url": "https://tiktok.com/@test/1"}],
    }

    assert nodes._extract_upload_post_urls(payload) == ["https://tiktok.com/@test/1"]


def test_extract_upload_post_urls_handles_non_mapping_items() -> None:
    payload = {"results": ["x", {"url": "https://tiktok.com/@test/2"}]}
    assert nodes._extract_upload_post_urls(payload) == ["https://tiktok.com/@test/2"]


def test_extract_upload_post_status_returns_none_for_non_mapping() -> None:
    assert nodes._extract_upload_post_status(["nope"]) is None


@pytest.mark.asyncio
async def test_poll_upload_post_status_returns_urls(monkeypatch) -> None:
    monkeypatch.setattr(nodes.settings, "upload_post_poll_interval_s", 0.01)
    monkeypatch.setattr(nodes.settings, "upload_post_poll_timeout_s", 1.0)
    monkeypatch.setattr(nodes.settings, "upload_post_api_key", "test-key")

    payloads = [
        {"status": "processing"},
        {
            "status": "completed",
            "results": [{"platform": "tiktok", "post_url": "https://tiktok.com/@test/2"}],
        },
    ]

    responses = []
    for payload in payloads:
        mock_response = Mock()
        mock_response.json.return_value = payload
        mock_response.raise_for_status = Mock()
        responses.append(mock_response)

    monkeypatch.setattr(nodes.anyio, "sleep", AsyncMock())

    with patch("myloware.workflows.langgraph.nodes.httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=responses)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        published_urls, error, last_payload = await nodes._poll_upload_post_status(
            "https://api.upload-post.com/api/uploadposts/status?request_id=req",
            request_id="req",
        )

    assert published_urls == ["https://tiktok.com/@test/2"]
    assert error is None
    assert last_payload == payloads[-1]


@pytest.mark.asyncio
async def test_poll_upload_post_status_returns_failure(monkeypatch) -> None:
    monkeypatch.setattr(nodes.settings, "upload_post_poll_interval_s", 0.01)
    monkeypatch.setattr(nodes.settings, "upload_post_poll_timeout_s", 1.0)

    payloads = [
        {"status": "failed"},
    ]

    responses = []
    for payload in payloads:
        mock_response = Mock()
        mock_response.json.return_value = payload
        mock_response.raise_for_status = Mock()
        responses.append(mock_response)

    monkeypatch.setattr(nodes.anyio, "sleep", AsyncMock())

    with patch("myloware.workflows.langgraph.nodes.httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=responses)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        published_urls, error, last_payload = await nodes._poll_upload_post_status(
            "https://status.test/1",
            request_id="req",
        )

    assert published_urls == []
    assert "failure" in (error or "")
    assert last_payload == payloads[-1]


@pytest.mark.asyncio
async def test_poll_upload_post_status_times_out_with_non_dict_payload(monkeypatch) -> None:
    monkeypatch.setattr(nodes.settings, "upload_post_poll_interval_s", 0.01)
    monkeypatch.setattr(nodes.settings, "upload_post_poll_timeout_s", 0.01)

    # First monotonic call sets deadline, second forces timeout.
    times = iter([0.0, 1.0])

    def fake_monotonic():
        return next(times, 1.0)

    monkeypatch.setattr(nodes.time, "monotonic", fake_monotonic)
    monkeypatch.setattr(nodes.anyio, "sleep", AsyncMock())

    mock_response = Mock()
    mock_response.json.return_value = ["raw"]
    mock_response.raise_for_status = Mock()

    with patch("myloware.workflows.langgraph.nodes.httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        published_urls, error, last_payload = await nodes._poll_upload_post_status(
            "https://status.test/timeout",
            request_id="req",
        )

    assert published_urls == []
    assert "Timed out" in (error or "")
    assert last_payload == {"raw": ["raw"]}


@pytest.mark.asyncio
async def test_poll_upload_post_status_success_false(monkeypatch) -> None:
    monkeypatch.setattr(nodes.settings, "upload_post_poll_interval_s", 0.01)
    monkeypatch.setattr(nodes.settings, "upload_post_poll_timeout_s", 1.0)

    payloads = [
        {"success": False},
    ]

    responses = []
    for payload in payloads:
        mock_response = Mock()
        mock_response.json.return_value = payload
        mock_response.raise_for_status = Mock()
        responses.append(mock_response)

    monkeypatch.setattr(nodes.anyio, "sleep", AsyncMock())

    with patch("myloware.workflows.langgraph.nodes.httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=responses)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        published_urls, error, last_payload = await nodes._poll_upload_post_status(
            "https://status.test/2",
            request_id="req",
        )

    assert published_urls == []
    assert "success=false" in (error or "")
    assert last_payload == payloads[-1]
