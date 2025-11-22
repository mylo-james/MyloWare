from __future__ import annotations

import pytest

from apps.mcp_adapter import main


@pytest.mark.asyncio
async def test_handle_ask_brendan_calls_api_chat(monkeypatch) -> None:
    called: list[tuple[str, str, dict | None]] = []

    async def fake_forward(method: str, url: str, *, json: dict | None = None):
        called.append((method, url, json))
        return {"response": "hi", "run_ids": []}

    monkeypatch.setattr(main, "_forward_api", fake_forward)

    result = await main.handle_ask_brendan({"user_id": "cli", "message": "Hello"})

    assert result == {"response": "hi", "run_ids": []}
    assert called == [
        (
            "POST",
            f"{main.settings.api_base_url}/v1/chat/brendan",
            {"user_id": "cli", "message": "Hello"},
        )
    ]


@pytest.mark.asyncio
async def test_handle_ask_brendan_requires_payload() -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await main.handle_ask_brendan({})
    assert exc.value.status_code == 400
