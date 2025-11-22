from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from core.knowledge import retrieval


def test_embed_texts_returns_hash_when_adapter_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retrieval, "EMBEDDINGS_AVAILABLE", False)
    monkeypatch.setattr(retrieval, "_EMBEDDING_CLIENT", None)
    embeddings = retrieval._embed_texts(["hello", "hello"])
    assert len(embeddings) == 2
    assert len(embeddings[0]) == 1536
    assert embeddings[0] == embeddings[1]
    assert any(value != 0.0 for value in embeddings[0])


def test_embed_texts_calls_adapter_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retrieval, "EMBEDDINGS_AVAILABLE", True)
    called: dict[str, object] = {}

    class FakeClient:
        def embed(self, texts, *, model=None):  # type: ignore[override]
            called["texts"] = list(texts)
            called["model"] = model
            return [[0.1, 0.2, 0.3]]

    monkeypatch.setattr(retrieval, "_EMBEDDING_CLIENT", FakeClient())

    vectors = retrieval._embed_texts(["chunk"], model="text-embedding-test")

    assert called["model"] == "text-embedding-test"
    assert called["texts"] == ["chunk"]
    assert vectors == [[0.1, 0.2, 0.3]]


class FakeCursor:
    def __init__(self, rows: list[tuple[str, str, float, str]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[tuple[str, str, float, str]]:
        return self._rows


class FakeConnection:
    def __init__(self, rows: list[tuple[str, str, float, str]]) -> None:
        self.rows = rows
        self.last_sql: str | None = None
        self.last_params: tuple[object, ...] | None = None

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - nothing to clean
        return None

    def execute(self, sql: str, params: tuple[object, ...]) -> FakeCursor:
        self.last_sql = sql
        self.last_params = params
        return FakeCursor(self.rows)


class FakeHistogram:
    def __init__(self) -> None:
        self.observed: list[float] = []
        self.labels_called_with: dict[str, str] | None = None

    def labels(self, **labels: str) -> "FakeHistogram":
        self.labels_called_with = {**labels}
        return self

    def observe(self, value: float) -> None:
        self.observed.append(value)


def test_search_kb_returns_rows_and_observes_latency(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [("doc-1", "data/projects/test/doc.md", 0.9, "snippet")]
    fake_conn = FakeConnection(rows)

    monkeypatch.setattr(retrieval, "_connect", lambda dsn: fake_conn)
    monkeypatch.setattr(retrieval, "_embed_texts", lambda texts: [[0.1] * 1536])
    fake_hist = FakeHistogram()
    monkeypatch.setattr(retrieval, "kb_search_seconds", fake_hist)

    results, latency_ms = retrieval.search_kb(
        "postgresql+psycopg://user:pass@localhost/db",
        "how to run",
        k=3,
        project="test_video_gen",
    )

    assert results == [("doc-1", "data/projects/test/doc.md", 0.9, "snippet")]
    assert isinstance(latency_ms, float)
    assert fake_conn.last_sql and "d.project = %s" in fake_conn.last_sql
    assert fake_conn.last_params == ("test_video_gen", 3)
    assert fake_hist.labels_called_with == {"project": "test_video_gen", "persona": "all"}
    assert fake_hist.observed  # latency observation recorded


def test_ingest_kb_records_markdown_and_json(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    base = tmp_path / "kb"
    project_dir = base / "projects" / "test_video_gen"
    persona_dir = base / "personas" / "riley"
    project_dir.mkdir(parents=True)
    persona_dir.mkdir(parents=True)
    (project_dir / "intro.md").write_text("# Intro\\nSome context", encoding="utf-8")
    (persona_dir / "bio.json").write_text('{"name": "Riley", "description": "Runs video QA"}', encoding="utf-8")

    dsns: list[str] = []

    class RecordingConnection:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...]]] = []

        def __enter__(self) -> "RecordingConnection":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - no cleanup
            return None

        def execute(self, sql: str, params: tuple[object, ...]) -> None:
            self.calls.append((sql.strip().split()[0], params))

    conn = RecordingConnection()

    def fake_connect(dsn: str) -> RecordingConnection:
        dsns.append(dsn)
        return conn

    monkeypatch.setattr(retrieval, "_connect", fake_connect)
    monkeypatch.setattr(retrieval, "_embed_texts", lambda texts: [[0.0] * 1536 for _ in texts])

    ingested = retrieval.ingest_kb("postgresql+psycopg://user:pass@localhost/db", base)

    assert ingested == 2
    assert dsns[0].startswith("postgresql://")
    assert len(conn.calls) == 4  # 2 docs * (doc insert + embedding insert)


def test_ingest_kb_chunks_large_files(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    base = tmp_path / "kb"
    project_dir = base / "projects" / "test_video_gen"
    project_dir.mkdir(parents=True)
    big_text = "A" * 25000
    (project_dir / "long.md").write_text(big_text, encoding="utf-8")

    class ChunkRecordingConnection:
        def __init__(self) -> None:
            self.calls = 0

        def __enter__(self) -> "ChunkRecordingConnection":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - nothing to clean
            return None

        def execute(self, sql: str, params: tuple[object, ...]) -> None:
            self.calls += 1

    conn = ChunkRecordingConnection()
    monkeypatch.setattr(retrieval, "_connect", lambda dsn: conn)
    monkeypatch.setattr(retrieval, "_embed_texts", lambda texts: [[0.0] * 1536 for _ in texts])
    monkeypatch.setattr(retrieval, "CHUNKING_AVAILABLE", True)

    class FakeSplitter:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def split_text(self, text: str) -> list[str]:
            return [text[:10000], text[10000:20000], text[20000:]]

    monkeypatch.setattr(retrieval, "RecursiveCharacterTextSplitter", FakeSplitter)

    ingested = retrieval.ingest_kb("postgresql://user@host/db", base)

    assert ingested == 3  # three chunks generated
    assert conn.calls == 6  # each chunk writes doc + embedding


def test_normalize_dsn_handles_sqlalchemy_prefix() -> None:
    assert retrieval._normalize_dsn("postgresql+psycopg://user@localhost/db") == "postgresql://user@localhost/db"
    assert retrieval._normalize_dsn("postgresql://user@localhost/db") == "postgresql://user@localhost/db"


def test_project_persona_from_path() -> None:
    project, persona = retrieval._project_persona_from_path(Path("/tmp/data/projects/aismr/doc.md"))
    assert project == "aismr"
    assert persona is None
    project2, persona2 = retrieval._project_persona_from_path(Path("/tmp/data/personas/riley/bio.json"))
    assert project2 is None
    assert persona2 == "riley"


def test_load_kb_content_formats_json(tmp_path: Path) -> None:
    payload = {"name": "Riley", "description": "QA"}
    path = tmp_path / "bio.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    text = retrieval._load_kb_content(path)
    assert "Riley" in text
    assert "```json" in text


def test_chunk_kb_content_respects_chunking(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retrieval, "CHUNKING_AVAILABLE", True)

    class FakeSplitter:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def split_text(self, text: str) -> list[str]:
            return [text[:5], text[5:10]]

    monkeypatch.setattr(retrieval, "RecursiveCharacterTextSplitter", FakeSplitter)
    content = "A" * 25000
    chunks = retrieval._chunk_kb_content(Path("large.md"), content)
    assert len(chunks) == 2
    assert chunks[0][1] == "_chunk0"


def test_chunk_kb_content_skips_when_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retrieval, "CHUNKING_AVAILABLE", False)
    chunks = retrieval._chunk_kb_content(Path("large.md"), "A" * 25000)
    assert chunks == []
