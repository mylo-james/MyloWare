"""Guards for LangGraph checkpointer DB."""

import pytest

from workflows.langgraph.graph import _get_async_checkpointer as _get_checkpointer
from config import settings


def test_checkpointer_rejects_sqlite(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "sqlite:///./test.db")
    with pytest.raises(RuntimeError):
        _get_checkpointer()
