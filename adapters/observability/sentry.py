from __future__ import annotations

from typing import Any

try:  # pragma: no cover - optional dependency that may not be installed during tests
    import sentry_sdk
except ImportError:  # pragma: no cover - graceful degradation without sentry-sdk
    sentry_sdk = None  # type: ignore[assignment]


def setup_sentry(*, dsn: str | None, environment: str, version: str) -> None:
    """Initialize Sentry when a DSN is provided and the SDK is available."""

    if not dsn or sentry_sdk is None:  # pragma: no cover - depends on deployment config
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=version,
        traces_sample_rate=0.0,
    )


def capture_exception(exc: BaseException | Exception) -> None:
    """Forward exceptions to Sentry when the SDK is available."""

    if sentry_sdk is None:  # pragma: no cover - harmless when SDK absent
        return
    sentry_sdk.capture_exception(exc)


def set_context(name: str, data: dict[str, Any]) -> None:
    """Add structured context to the active Sentry scope when SDK is installed."""

    if sentry_sdk is None:  # pragma: no cover - optional instrumentation
        return
    if hasattr(sentry_sdk, "set_context"):  # pragma: no cover - requires SDK
        sentry_sdk.set_context(name, data)
