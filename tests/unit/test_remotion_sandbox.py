import pytest

pytest.importorskip("fastapi")  # ensure core deps installed in test env
from myloware.config import settings
from myloware.tools.remotion import RemotionRenderTool
import httpx


@pytest.mark.asyncio
async def test_remotion_blocks_composition_code_without_sandbox(monkeypatch):
    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_allow_composition_code", False)
    monkeypatch.setattr(settings, "remotion_sandbox_enabled", False)
    monkeypatch.setattr(settings, "remotion_service_url", "http://localhost:3001")
    tool = RemotionRenderTool(run_id="test")

    with pytest.raises(ValueError) as excinfo:
        await tool.async_run_impl(
            clips=["http://example.com/a.mp4"],
            composition_code="export const RemotionComposition = () => null;",
        )

    assert "composition_code is disabled" in str(excinfo.value)


@pytest.mark.asyncio
async def test_remotion_tool_sends_auth_headers(monkeypatch):
    captured = {}

    class DummyClient:
        def __init__(self, *args, **kwargs):
            self.headers = kwargs.get("headers")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            return False

        async def post(self, url, json=None, headers=None):
            captured.update(headers or {})
            return httpx.Response(
                202,
                json={"job_id": "1", "status": "queued"},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(httpx, "AsyncClient", DummyClient)

    monkeypatch.setattr(settings, "remotion_provider", "real")
    monkeypatch.setattr(settings, "remotion_allow_composition_code", False)
    monkeypatch.setattr(settings, "remotion_sandbox_enabled", True)
    monkeypatch.setattr(settings, "remotion_api_secret", "secret123")
    monkeypatch.setattr(settings, "remotion_service_url", "http://localhost:3001")

    tool = RemotionRenderTool(run_id="r1")
    await tool.async_run_impl(
        clips=["http://example.com/a.mp4"],
        template="aismr",
        objects=["obj"] * 12,
    )

    assert captured.get("Authorization") == "Bearer secret123"
    assert captured.get("x-api-key") == "secret123"
