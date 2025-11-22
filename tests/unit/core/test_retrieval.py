from __future__ import annotations

from typing import Any

import pytest
from prometheus_client import REGISTRY

from core.knowledge import retrieval


def test_embed_texts_offline_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retrieval, "OPENAI_AVAILABLE", False, raising=False)

    vectors = retrieval._embed_texts(["hello world", "hello world"])  # pylint: disable=protected-access

    assert len(vectors) == 2
    assert len(vectors[0]) == 1536
    assert vectors[0] == vectors[1], "deterministic hashing should match for identical inputs"


def test_search_kb_applies_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {}

    def fake_embed_texts(texts, model="text-embedding-3-small"):  # noqa: ANN001
        called["texts"] = list(texts)
        return [[0.1, 0.2, 0.3]]

    class FakeCursor:
        def fetchall(self):
            return [("doc-1", "path/to/doc.md", 0.87, "snippet")]

    class FakeConn:
        def __init__(self):
            self.executed: tuple[str, tuple[Any, ...]] | None = None

        def execute(self, sql: str, params: tuple[Any, ...]) -> FakeCursor:
            self.executed = (sql, params)
            return FakeCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    fake_conn = FakeConn()

    monkeypatch.setattr(retrieval, "_embed_texts", fake_embed_texts, raising=False)
    monkeypatch.setattr(retrieval, "_connect", lambda dsn: fake_conn, raising=False)

    results, latency = retrieval.search_kb(
        "postgresql://test",
        query="candle tutorial",
        k=5,
        project="aismr",
        persona="iggy",
    )

    assert latency >= 0
    assert results[0][0] == "doc-1"
    assert called["texts"] == ["candle tutorial"]
    assert fake_conn.executed is not None
    sql, params = fake_conn.executed
    assert "(d.project = %s OR d.project IS NULL)" in sql
    assert "(d.persona = %s OR d.persona IS NULL)" in sql
    assert params == ("aismr", "iggy", 5)


def test_search_kb_bubbles_up_db_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_embed_texts(texts, model="text-embedding-3-small"):  # noqa: ANN001
        return [[0.1, 0.2, 0.3]]

    def failing_connect(_dsn: str):
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(retrieval, "_embed_texts", fake_embed_texts, raising=False)
    monkeypatch.setattr(retrieval, "_connect", failing_connect, raising=False)

    with pytest.raises(RuntimeError):
        retrieval.search_kb(
            "postgresql://test",
            query="candle tutorial",
            k=5,
            project="aismr",
            persona="iggy",
        )


def test_search_kb_records_latency_metric(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_embed_texts(texts, model="text-embedding-3-small"):
        return [[0.1, 0.2, 0.3]]

    class FakeCursor:
        def fetchall(self):
            return [("doc-2", "docs/aismr.md", 0.91, "snippet")]

    class FakeConn:
        def execute(self, sql: str, params: tuple[Any, ...]) -> FakeCursor:
            return FakeCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):  # noqa: D401
            return False

    monkeypatch.setattr(retrieval, "_embed_texts", fake_embed_texts, raising=False)
    monkeypatch.setattr(retrieval, "_connect", lambda dsn: FakeConn(), raising=False)

    labelset = {"project": "aismr", "persona": "iggy"}
    before = REGISTRY.get_sample_value("kb_search_seconds_count", labelset) or 0.0

    retrieval.search_kb(
        "postgresql://test",
        query="surreal candle",
        k=3,
        project="aismr",
        persona="iggy",
    )

    after = REGISTRY.get_sample_value("kb_search_seconds_count", labelset) or 0.0
    assert after == pytest.approx(before + 1.0)
