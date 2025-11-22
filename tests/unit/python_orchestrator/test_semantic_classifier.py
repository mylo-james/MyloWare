from __future__ import annotations

from types import SimpleNamespace

from apps.orchestrator import semantic_classifier


class FakeStructuredLLM:
    def __init__(self, response: semantic_classifier.ProjectClassification) -> None:
        self.response = response
        self.messages: list[dict[str, str]] | None = None

    def invoke(self, messages: list[dict[str, str]]) -> semantic_classifier.ProjectClassification:
        self.messages = messages
        return self.response


class FakeLLM:
    def __init__(self, response: semantic_classifier.ProjectClassification) -> None:
        self.response = response
        self.used = False

    def with_structured_output(self, schema):  # type: ignore[override]
        self.used = True
        return FakeStructuredLLM(self.response)


def test_fallback_classification_handles_keywords(monkeypatch) -> None:
    monkeypatch.setattr(semantic_classifier, "LANGCHAIN_AVAILABLE", False)
    result = semantic_classifier.classify_request("Make a simple AISMR video about candles with soundtrack")
    assert result.project == "aismr"
    assert result.object == "candle"
    assert result.complexity == "simple"
    assert "alex" in result.skip_steps
    assert result.optional_personas == ["morgan"]


def test_classify_request_uses_langchain_when_available(monkeypatch) -> None:
    monkeypatch.setattr(semantic_classifier, "LANGCHAIN_AVAILABLE", True)
    expected = semantic_classifier.ProjectClassification(
        project="test_video_gen",
        object="books",
        complexity="standard",
    )

    fake_llm = FakeLLM(expected)
    monkeypatch.setattr(semantic_classifier, "ChatOpenAI", lambda **_: fake_llm)

    result = semantic_classifier.classify_request("Create a run about books")

    assert fake_llm.used
    assert result.object == "books"


def test_classify_request_falls_back_when_langchain_errors(monkeypatch) -> None:
    monkeypatch.setattr(semantic_classifier, "LANGCHAIN_AVAILABLE", True)

    class FailingLLM:
        def with_structured_output(self, schema):  # type: ignore[override]
            return self

        def invoke(self, messages):
            raise RuntimeError("boom")

    monkeypatch.setattr(semantic_classifier, "ChatOpenAI", lambda **_: FailingLLM())
    result = semantic_classifier.classify_request("Make an AISMR video with candles")
    assert result.project in {"aismr", "test_video_gen"}
