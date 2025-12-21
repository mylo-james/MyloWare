"""Provider mode helpers.

This centralizes the "effective provider mode" rules so we don't re-implement
slightly different logic across tools/routes/workflows.

Rule:
- Per-provider mode is the source of truth ("real" | "fake" | "off")
- `use_fake_providers=True` downgrades any "real" provider to "fake" (but never
  overrides "off")
"""

from __future__ import annotations

from typing import Literal

from myloware.config.settings import Settings

ProviderMode = Literal["real", "fake", "off"]


def _coerce_mode(value: object, *, default: ProviderMode) -> ProviderMode:
    """Best-effort normalize provider mode.

    Unknown/invalid values fall back to `default` (fail-closed when default="real").
    """
    if isinstance(value, str):
        lowered = value.lower()
        if lowered in {"real", "fake", "off"}:
            return lowered  # type: ignore[return-value]
    return default


def _coerce_bool(value: object, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "y", "on"}:
            return True
        if lowered in {"0", "false", "no", "n", "off"}:
            return False
    return default


def _effective_mode(mode: ProviderMode, *, use_fake_providers: bool) -> ProviderMode:
    if use_fake_providers and mode == "real":
        return "fake"
    return mode


def effective_llama_stack_provider(settings: Settings) -> ProviderMode:
    mode = _coerce_mode(getattr(settings, "llama_stack_provider", "real"), default="real")
    use_fake = _coerce_bool(getattr(settings, "use_fake_providers", False), default=False)
    return _effective_mode(mode, use_fake_providers=use_fake)


def effective_sora_provider(settings: Settings) -> ProviderMode:
    mode = _coerce_mode(getattr(settings, "sora_provider", "real"), default="real")
    use_fake = _coerce_bool(getattr(settings, "use_fake_providers", False), default=False)
    return _effective_mode(mode, use_fake_providers=use_fake)


def effective_remotion_provider(settings: Settings) -> ProviderMode:
    mode = _coerce_mode(getattr(settings, "remotion_provider", "real"), default="real")
    use_fake = _coerce_bool(getattr(settings, "use_fake_providers", False), default=False)
    return _effective_mode(mode, use_fake_providers=use_fake)


def effective_upload_post_provider(settings: Settings) -> ProviderMode:
    mode = _coerce_mode(getattr(settings, "upload_post_provider", "real"), default="real")
    use_fake = _coerce_bool(getattr(settings, "use_fake_providers", False), default=False)
    return _effective_mode(mode, use_fake_providers=use_fake)
