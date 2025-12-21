"""Tests for request classification."""

from __future__ import annotations

from typing import Any

import pytest


class FakeChatBackend:
    def __init__(self, payload: object | None = None, exc: Exception | None = None):
        self.payload = payload
        self.exc = exc

    def chat_json(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> dict[str, Any]:
        if self.exc:
            raise self.exc
        assert isinstance(messages, list)
        assert messages and messages[0]["role"] == "system"
        if not isinstance(self.payload, dict):
            raise TypeError("payload must be a dict")
        return self.payload


class FakeAsyncChatBackend:
    def __init__(self, payload: object | None = None, exc: Exception | None = None):
        self.payload = payload
        self.exc = exc

    async def chat_json_async(
        self, *, messages: list[dict[str, Any]], model_id: str | None = None
    ) -> dict[str, Any]:
        if self.exc:
            raise self.exc
        assert isinstance(messages, list)
        assert messages and messages[0]["role"] == "system"
        if not isinstance(self.payload, dict):
            raise TypeError("payload must be a dict")
        return self.payload


class TestLLMClassifier:
    def test_classify_start_run(self):
        from myloware.agents.classifier import classify_request

        backend = FakeChatBackend(
            {"intent": "start_run", "project": "motivational", "confidence": 0.95}
        )
        result = classify_request(backend, "run a test video")

        assert result.intent == "start_run"
        assert result.project == "motivational"
        assert result.confidence == 0.95

    def test_classify_check_status(self):
        from myloware.agents.classifier import classify_request

        backend = FakeChatBackend(
            {"intent": "check_status", "run_id": "abc-123", "confidence": 0.9}
        )
        result = classify_request(backend, "what's the status of abc-123")

        assert result.intent == "check_status"
        assert result.run_id == "abc-123"

    def test_classify_approve_gate(self):
        from myloware.agents.classifier import classify_request

        backend = FakeChatBackend(
            {"intent": "approve_gate", "gate": "ideation", "confidence": 0.88}
        )
        result = classify_request(backend, "approve ideation")

        assert result.intent == "approve_gate"
        assert result.gate == "ideation"

    def test_classify_aismr_project(self):
        from myloware.agents.classifier import classify_request

        backend = FakeChatBackend(
            {
                "intent": "start_run",
                "project": "aismr",
                "custom_object": "candles",
                "confidence": 0.92,
            }
        )
        result = classify_request(backend, "make an asmr video about candles")

        assert result.intent == "start_run"
        assert result.project == "aismr"
        assert result.custom_object == "candles"

    def test_classify_maps_string_confidence(self):
        from myloware.agents.classifier import classify_request

        backend = FakeChatBackend({"intent": "help", "confidence": "high"})
        result = classify_request(backend, "help")

        assert result.intent == "help"
        assert result.confidence == 0.9

    def test_classify_defaults_confidence_for_unknown_type(self):
        from myloware.agents.classifier import classify_request

        backend = FakeChatBackend({"intent": "help", "confidence": {"weird": True}})
        result = classify_request(backend, "help")

        assert result.intent == "help"
        assert result.confidence == 0.8

    def test_classify_propagates_backend_error(self):
        from myloware.agents.classifier import classify_request

        backend = FakeChatBackend(exc=RuntimeError("API unavailable"))

        with pytest.raises(RuntimeError, match="API unavailable"):
            classify_request(backend, "test message")


class TestLLMClassifierAsync:
    @pytest.mark.anyio
    async def test_classify_async_maps_string_confidence(self):
        from myloware.agents.classifier import classify_request_async

        backend = FakeAsyncChatBackend({"intent": "help", "confidence": "medium"})
        result = await classify_request_async(backend, "help")

        assert result.intent == "help"
        assert result.confidence == 0.7

    @pytest.mark.anyio
    async def test_classify_async_accepts_numeric_confidence(self):
        from myloware.agents.classifier import classify_request_async

        backend = FakeAsyncChatBackend({"intent": "help", "confidence": 0.95})
        result = await classify_request_async(backend, "help")

        assert result.intent == "help"
        assert result.confidence == 0.95

    @pytest.mark.anyio
    async def test_classify_async_defaults_confidence_for_unknown_type(self):
        from myloware.agents.classifier import classify_request_async

        backend = FakeAsyncChatBackend({"intent": "help", "confidence": []})
        result = await classify_request_async(backend, "help")

        assert result.intent == "help"
        assert result.confidence == 0.8

    @pytest.mark.anyio
    async def test_classify_async_propagates_backend_error(self):
        from myloware.agents.classifier import classify_request_async

        backend = FakeAsyncChatBackend(exc=RuntimeError("API unavailable"))

        with pytest.raises(RuntimeError, match="API unavailable"):
            await classify_request_async(backend, "test message")
