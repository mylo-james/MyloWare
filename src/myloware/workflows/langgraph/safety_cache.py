"""Safety caching helpers for LangGraph replayability.

We store successful (and non-system-error) safety verdicts keyed by a hash of the
exact content/messages. On replay/time-travel, the cached verdict is reused so we
don't re-hit shields and get a different decision or a transient outage.

Fail-closed remains intact:
- No cache => we call the shield.
- Cached system_error => we re-call the shield (never reused).
- Cached violation => reused (still blocked) to avoid re-submitting unsafe content.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List

from myloware.safety.shields import SafetyResult, check_agent_input, check_agent_output

CacheDict = Dict[str, Dict[str, Any]]


def _hash_payload(payload: str) -> str:
    """Deterministic hash for cache keys."""
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _get_cache(state: Dict[str, Any]) -> CacheDict:
    """Return a mutable safety cache from state."""
    return state.get("safety_cache", {}) or {}


def _store_result(
    state: Dict[str, Any], cache_key: str, content_hash: str, result: SafetyResult
) -> None:
    """Persist safety verdict into state cache."""
    cache = _get_cache(state).copy()
    cache[cache_key] = {
        "hash": content_hash,
        "safe": result.safe,
        "reason": result.reason,
        "category": result.category,
        "severity": result.severity,
    }
    state["safety_cache"] = cache


def _maybe_reuse(cache_entry: Dict[str, Any], content_hash: str) -> SafetyResult | None:
    """Return cached result if reusable; otherwise None to force a new check."""
    if not cache_entry:
        return None
    if cache_entry.get("hash") != content_hash:
        return None

    # Safe verdicts are always reusable
    if cache_entry.get("safe") is True:
        return SafetyResult.passed()

    # Violations are reusable (fail fast) unless the category was a system error.
    if cache_entry.get("category") and cache_entry["category"] != "system_error":
        return SafetyResult.failed(
            reason=cache_entry.get("reason") or "Content blocked",
            category=cache_entry.get("category"),
            severity=cache_entry.get("severity"),
        )

    # For system_error we re-run to give the shield a chance to recover
    return None


async def guard_input_with_cache(
    state: Dict[str, Any],
    async_client: Any,
    cache_key: str,
    messages: List[Dict[str, str]],
) -> SafetyResult:
    """Run input safety with replay-aware caching."""
    payload = "\n".join(f"{m.get('role')}: {m.get('content','')}" for m in messages)
    content_hash = _hash_payload(payload)
    cached = _maybe_reuse(_get_cache(state).get(cache_key), content_hash)
    if cached:
        return cached

    result = await check_agent_input(async_client, messages)
    _store_result(state, cache_key, content_hash, result)
    return result


async def guard_output_with_cache(
    state: Dict[str, Any],
    async_client: Any,
    cache_key: str,
    content: str,
) -> SafetyResult:
    """Run output safety with replay-aware caching."""
    payload = content or ""
    content_hash = _hash_payload(payload)
    cached = _maybe_reuse(_get_cache(state).get(cache_key), content_hash)
    if cached:
        return cached

    result = await check_agent_output(async_client, payload)
    _store_result(state, cache_key, content_hash, result)
    return result
