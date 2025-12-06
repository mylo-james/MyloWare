"""Tests for knowledge base and guardrails loading."""

from __future__ import annotations

from config.guardrails import get_guardrail_summary, load_guardrails
from knowledge import load_knowledge_documents, list_knowledge_documents


def test_list_knowledge_documents():
    docs = list_knowledge_documents()
    assert len(docs) >= 3
    assert "editor-knowledge" in docs or "remotion-api-docs" in docs


def test_load_knowledge_documents_contains_content_and_metadata():
    docs = list(load_knowledge_documents())
    assert docs, "Expected knowledge documents to load"
    first = docs[0]
    assert first.id.startswith("kb_")
    assert first.filename.endswith(".md")
    assert len(first.content) > 50
    assert first.metadata.get("source") == "knowledge_base"


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
