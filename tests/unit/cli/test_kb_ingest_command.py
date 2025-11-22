from __future__ import annotations

from pathlib import Path

from cli import main as cli_main


def test_kb_ingest_invokes_ingest_kb(tmp_path, monkeypatch, capsys):
    kb_dir = tmp_path / "kb"
    kb_dir.mkdir()
    (kb_dir / "doc.md").write_text("hello world", encoding="utf-8")

    called: dict[str, str] = {}

    def fake_ingest(dsn: str, directory: Path) -> int:
        called["dsn"] = dsn
        called["dir"] = str(directory)
        return 5

    def fake_verify(dsn: str) -> dict[str, int]:
        return {"kb_documents": 5, "kb_embeddings": 5, "dsn": dsn}  # type: ignore[return-value]

    monkeypatch.setenv("DB_URL", "postgresql+psycopg://user:pass@localhost:5432/db")
    monkeypatch.setattr("core.knowledge.ingest_kb", fake_ingest)
    monkeypatch.setattr(cli_main, "_verify_kb_counts", fake_verify)

    exit_code = cli_main.main(["kb", "ingest", "--dir", str(kb_dir)])

    assert exit_code == 0
    assert called["dir"] == str(kb_dir)
    assert called["dsn"].startswith("postgresql://")
    out = capsys.readouterr().out
    assert "KB ingest complete" in out
    assert '"ingested": 5' in out


def test_kb_ingest_missing_directory(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("DB_URL", "postgresql://localhost/myloware")
    missing = tmp_path / "missing"

    exit_code = cli_main.main(["kb", "ingest", "--dir", str(missing)])

    assert exit_code == 2
    out = capsys.readouterr().out
    assert "KB directory not found" in out
