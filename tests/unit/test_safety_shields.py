"""Unit tests for Llama Stack safety shield helpers (fail-closed)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest


def test_safety_result_from_shield_response_passes_when_no_violation() -> None:
    from myloware.safety.shields import SafetyResult

    response = SimpleNamespace(violation=None)
    result = SafetyResult.from_shield_response(response)
    assert result.safe is True
    assert result.reason is None


def test_safety_result_from_shield_response_fails_with_user_message() -> None:
    from myloware.safety.shields import SafetyResult

    violation = SimpleNamespace(
        user_message="blocked",
        explanation="explain",
        category="cat",
        severity="high",
    )
    response = SimpleNamespace(violation=violation)
    result = SafetyResult.from_shield_response(response)
    assert result.safe is False
    assert result.reason == "blocked"
    assert result.category == "cat"
    assert result.severity == "high"


def test_moderation_result_from_response_handles_empty_results() -> None:
    from myloware.safety.shields import ModerationResult

    response = SimpleNamespace(results=[])
    result = ModerationResult.from_response(response)
    assert result.flagged is False
    assert result.safe is True


def test_moderation_result_top_categories() -> None:
    from myloware.safety.shields import ModerationResult

    result = ModerationResult(flagged=False, category_scores={"a": 0.6, "b": 0.4})
    assert result.get_top_categories(threshold=0.5) == ["a"]


@pytest.mark.anyio
async def test_run_shield_uses_async_client_branch(monkeypatch) -> None:
    from myloware.safety import shields as mod

    class FakeAsyncClient:
        def __init__(self) -> None:
            self.safety = SimpleNamespace(
                run_shield=AsyncMock(return_value=SimpleNamespace(violation=None))
            )

    # Ensure isinstance(..., AsyncLlamaStackClient) is true for FakeAsyncClient.
    monkeypatch.setattr(mod, "AsyncLlamaStackClient", FakeAsyncClient)

    client = FakeAsyncClient()
    out = await mod._run_shield(client, shield_id="s", messages=[{"role": "user", "content": "x"}])
    assert getattr(out, "violation", None) is None


@pytest.mark.anyio
async def test_run_shield_uses_sync_client_branch(monkeypatch) -> None:
    from myloware.safety import shields as mod

    class FakeSyncClient:
        def __init__(self) -> None:
            self.safety = SimpleNamespace(
                run_shield=MagicMock(return_value=SimpleNamespace(violation=None))
            )

    monkeypatch.setattr(mod.anyio.to_thread, "run_sync", AsyncMock(side_effect=lambda fn: fn()))

    client = FakeSyncClient()
    out = await mod._run_shield(client, shield_id="s", messages=[{"role": "user", "content": "x"}])
    assert getattr(out, "violation", None) is None


@pytest.mark.anyio
async def test_check_content_safety_skips_remote_when_fake_provider(monkeypatch) -> None:
    from myloware.safety import shields as mod

    monkeypatch.setattr(mod.settings, "use_fake_providers", True)
    monkeypatch.setattr(mod.settings, "llama_stack_provider", "fake")

    result = await mod.check_content_safety(MagicMock(), "hello")
    assert result.safe is True


@pytest.mark.anyio
async def test_check_content_safety_real_provider_success(monkeypatch) -> None:
    from myloware.safety import shields as mod

    monkeypatch.setattr(mod.settings, "use_fake_providers", False)
    monkeypatch.setattr(mod.settings, "llama_stack_provider", "real")

    run_shield = AsyncMock(return_value=SimpleNamespace(violation=None))
    monkeypatch.setattr(mod, "_run_shield", run_shield)

    result = await mod.check_content_safety(MagicMock(), "hello", shield_id="shield")
    assert result.safe is True
    run_shield.assert_awaited_once()


@pytest.mark.anyio
async def test_check_content_safety_real_provider_violation(monkeypatch) -> None:
    from myloware.safety import shields as mod

    monkeypatch.setattr(mod.settings, "use_fake_providers", False)
    monkeypatch.setattr(mod.settings, "llama_stack_provider", "real")

    violation = SimpleNamespace(user_message="nope", category="c", severity="s")
    monkeypatch.setattr(
        mod, "_run_shield", AsyncMock(return_value=SimpleNamespace(violation=violation))
    )

    result = await mod.check_content_safety(MagicMock(), "hello", shield_id="shield")
    assert result.safe is False
    assert result.reason == "nope"
    assert result.category == "c"
    assert result.severity == "s"


@pytest.mark.anyio
async def test_check_content_safety_real_provider_fails_closed(monkeypatch) -> None:
    from myloware.safety import shields as mod

    monkeypatch.setattr(mod.settings, "use_fake_providers", False)
    monkeypatch.setattr(mod.settings, "llama_stack_provider", "real")
    monkeypatch.setattr(mod, "_run_shield", AsyncMock(side_effect=RuntimeError("boom")))

    result = await mod.check_content_safety(MagicMock(), "hello", shield_id="shield")
    assert result.safe is False
    assert result.category == "system_error"
    assert "boom" in (result.reason or "")


@pytest.mark.anyio
async def test_moderate_content_success_and_fail_closed(monkeypatch) -> None:
    from myloware.safety import shields as mod

    # Success path (not flagged)
    ok_resp = SimpleNamespace(
        results=[
            SimpleNamespace(
                flagged=False,
                categories={"a": False},
                category_scores={"a": 0.1},
                metadata={"violation_type": []},
            )
        ]
    )
    client_ok = SimpleNamespace(moderations=SimpleNamespace(create=MagicMock(return_value=ok_resp)))
    ok = await mod.moderate_content(client_ok, "x")
    assert ok.safe is True

    # Flagged path (logs + returns flagged)
    flagged_resp = SimpleNamespace(
        results=[
            SimpleNamespace(
                flagged=True,
                categories={"violence": True},
                category_scores={"violence": 0.9},
                metadata={"violation_type": ["violence"]},
            )
        ]
    )
    client_flagged = SimpleNamespace(
        moderations=SimpleNamespace(create=MagicMock(return_value=flagged_resp))
    )
    flagged = await mod.moderate_content(client_flagged, "x")
    assert flagged.safe is False
    assert flagged.flagged is True

    # Failure path (exception -> flagged True)
    client_fail = SimpleNamespace(
        moderations=SimpleNamespace(create=MagicMock(side_effect=RuntimeError("x")))
    )
    bad = await mod.moderate_content(client_fail, "x")
    assert bad.safe is False
    assert bad.categories.get("system_error") is True


@pytest.mark.anyio
async def test_check_brief_safety_and_agent_input_output_delegation(monkeypatch) -> None:
    from myloware.safety import shields as mod

    fake_result = mod.SafetyResult.passed()
    check = AsyncMock(return_value=fake_result)
    monkeypatch.setattr(mod, "check_content_safety", check)

    client = MagicMock()
    out = await mod.check_brief_safety(client, "brief", shield_id="s")
    assert out.safe is True
    check.assert_awaited_with(client, "brief", "s")

    # No user messages -> pass without calling shield.
    out2 = await mod.check_agent_input(
        client, messages=[{"role": "system", "content": "x"}], shield_id="s"
    )
    assert out2.safe is True

    out3 = await mod.check_agent_input(
        client,
        messages=[{"role": "user", "content": "u1"}, {"role": "user", "content": "u2"}],
        shield_id="s",
    )
    assert out3.safe is True
    assert check.await_count >= 2

    out4 = await mod.check_agent_output(client, response_content="resp", shield_id="s")
    assert out4.safe is True
