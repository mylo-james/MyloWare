"""Tests for knowledge base and guardrails loading."""

from __future__ import annotations

from config.guardrails import get_guardrail_summary, load_guardrails
from knowledge import load_documents_with_manifest, list_knowledge_documents


def test_list_knowledge_documents():
    docs = list_knowledge_documents()
    assert len(docs) >= 3
    assert "editor-knowledge" in docs or "remotion-api-docs" in docs


def test_load_documents_with_manifest_contains_content_and_metadata():
    docs, manifest = load_documents_with_manifest(project_id=None)
    assert docs, "Expected knowledge documents to load"
    assert manifest.get("hash")
    first = docs[0]
    assert first.id.startswith("kb_")
    assert first.filename.endswith(".md")
    assert len(first.content) > 50
    assert "kb_type" in first.metadata
    assert "document" in first.metadata
    assert first.metadata.get("chunk_index", 0) >= 0


def test_load_guardrails_projects():
    aismr = load_guardrails("aismr")
    test_vid = load_guardrails("test_video_gen")
    assert len(aismr) >= 5
    assert len(test_vid) >= 1


def test_guardrail_summary_readable():
    summary = get_guardrail_summary("aismr")
    assert summary == "" or "Guardrails" in summary
    # If guardrails exist, expect some content
    if summary:
        assert len(summary) > 30


def test_guardrails_missing_project_returns_empty():
    assert load_guardrails("nonexistent_project") == {}
    assert get_guardrail_summary("nonexistent_project") == ""
