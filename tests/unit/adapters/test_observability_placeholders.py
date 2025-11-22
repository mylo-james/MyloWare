from __future__ import annotations

from adapters.observability import sentry, tracing


def test_setup_sentry_noop() -> None:
    assert sentry.setup_sentry(dsn=None, environment="test", version="0.0.1") is None


def test_setup_tracing_noop() -> None:
    class DummyApp:  # minimal FastAPI stand-in
        pass

    app = DummyApp()  # type: ignore[arg-type]
    assert tracing.setup_tracing(app, service_name="api", environment="test", version="0.0.1") is None
