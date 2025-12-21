"""Unit tests for metrics route."""

from __future__ import annotations

from unittest.mock import Mock


def test_metrics_returns_prometheus_payload(monkeypatch) -> None:
    from myloware.api.routes import metrics as metrics_mod

    monkeypatch.setattr(metrics_mod, "generate_latest", Mock(return_value=b"ok"))

    resp = metrics_mod.metrics()
    assert resp.media_type == metrics_mod.CONTENT_TYPE_LATEST
    assert resp.body == b"ok"
