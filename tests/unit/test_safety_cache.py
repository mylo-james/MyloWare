"""Unit tests for LangGraph safety cache helpers."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


def test_hash_payload_is_deterministic() -> None:
    from myloware.workflows.langgraph.safety_cache import _hash_payload

    assert _hash_payload("x") == _hash_payload("x")
    assert _hash_payload("x") != _hash_payload("y")


def test_store_and_reuse_cache_entries() -> None:
    from myloware.safety.shields import SafetyResult
    from myloware.workflows.langgraph.safety_cache import _maybe_reuse, _store_result

    state: dict[str, object] = {}
    key = "k"
    content_hash = "h"

    _store_result(state, key, content_hash, SafetyResult.passed())
    entry = state["safety_cache"][key]  # type: ignore[index]
    assert _maybe_reuse(entry, content_hash).safe is True  # type: ignore[union-attr]

    _store_result(state, key, content_hash, SafetyResult.failed("blocked", category="policy"))
    entry2 = state["safety_cache"][key]  # type: ignore[index]
    reused = _maybe_reuse(entry2, content_hash)
    assert reused and reused.safe is False
    assert reused.category == "policy"

    # system_error is never reused.
    _store_result(state, key, content_hash, SafetyResult.failed("down", category="system_error"))
    entry3 = state["safety_cache"][key]  # type: ignore[index]
    assert _maybe_reuse(entry3, content_hash) is None

    # Hash mismatch -> not reusable.
    assert _maybe_reuse(entry3, "different") is None


@pytest.mark.anyio
async def test_guard_input_and_output_with_cache(monkeypatch) -> None:
    from myloware.safety.shields import SafetyResult
    from myloware.workflows.langgraph import safety_cache as mod

    check_in = AsyncMock(return_value=SafetyResult.passed())
    check_out = AsyncMock(return_value=SafetyResult.failed("no", category="policy"))
    monkeypatch.setattr(mod, "check_agent_input", check_in)
    monkeypatch.setattr(mod, "check_agent_output", check_out)

    state: dict[str, object] = {}
    client = MagicMock()

    # First call stores.
    r1 = await mod.guard_input_with_cache(
        state,
        async_client=client,
        cache_key="in",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert r1.safe is True
    assert check_in.await_count == 1

    # Second call reuses.
    r2 = await mod.guard_input_with_cache(
        state,
        async_client=client,
        cache_key="in",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert r2.safe is True
    assert check_in.await_count == 1

    # Output: first call stores failed result.
    r3 = await mod.guard_output_with_cache(state, client, cache_key="out", content="resp")
    assert r3.safe is False
    assert r3.category == "policy"
    assert check_out.await_count == 1

    # Reuse failed-but-not-system_error.
    r4 = await mod.guard_output_with_cache(state, client, cache_key="out", content="resp")
    assert r4.safe is False
    assert check_out.await_count == 1
