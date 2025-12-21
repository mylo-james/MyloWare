import pytest

from myloware.config import settings
from myloware.tools.remotion import RemotionRenderTool


@pytest.mark.anyio
@pytest.mark.integration
async def test_remotion_rejects_composition_without_sandbox(monkeypatch):
    monkeypatch.setattr(settings, "remotion_allow_composition_code", False)
    monkeypatch.setattr(settings, "remotion_sandbox_enabled", False)
    monkeypatch.setattr(settings, "remotion_service_url", "http://localhost:3001")
    monkeypatch.setattr(settings, "remotion_provider", "real")

    tool = RemotionRenderTool(run_id="test-run")

    with pytest.raises(ValueError) as excinfo:
        await tool.async_run_impl(
            clips=["https://example.com/a.mp4"],
            composition_code="export const RemotionComposition = () => null;",
        )

    assert "composition_code is disabled" in str(excinfo.value)
