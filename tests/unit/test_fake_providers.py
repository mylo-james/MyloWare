import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from agents.factory import create_agent
from config import settings


def test_fake_provider_guard_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "llama_stack_provider", "fake")

    with pytest.raises(RuntimeError) as excinfo:
        create_agent(client=None, project="aismr", role="ideator")

    assert "LLAMA_STACK_PROVIDER" in str(excinfo.value)
