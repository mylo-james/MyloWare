from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from myloware.storage.models import RunStatus
from myloware.workflows.langgraph import hitl


class FakeRun:
    def __init__(self, run_id, status: str):
        self.id = run_id
        self.status = status
        self.user_id = "user"
        self.artifacts = {"ideas": "test"}
        self.current_step = "ideation"
        self.error = None


class FakeRunRepo:
    def __init__(self, run: FakeRun | None) -> None:
        self._run = run

    async def get_async(self, _run_id):  # type: ignore[no-untyped-def]
        return self._run


class FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
        return None


def _session_factory():
    return lambda: FakeSession()


class FakeInterrupt:
    def __init__(self, value: dict, interrupt_id: str | None = "intr-1") -> None:
        self.value = value
        self.id = interrupt_id


class FakeGraph:
    def __init__(self, interrupts):
        self._interrupts = interrupts
        self.invoked = []

    async def aget_state(self, _config):  # type: ignore[no-untyped-def]
        return SimpleNamespace(interrupts=self._interrupts)

    async def ainvoke(self, cmd, *, config, durability):  # type: ignore[no-untyped-def]
        self.invoked.append((cmd, config, durability))
        return {}


@pytest.mark.asyncio
async def test_resume_hitl_gate_requires_langgraph_engine(monkeypatch):
    monkeypatch.setattr(hitl.settings, "use_langgraph_engine", False)
    with pytest.raises(ValueError, match="LangGraph engine is not enabled"):
        await hitl.resume_hitl_gate(uuid4(), "ideation", approved=True)


@pytest.mark.asyncio
async def test_resume_hitl_gate_status_mismatch(monkeypatch):
    run_id = uuid4()
    run = FakeRun(run_id, RunStatus.RUNNING.value)

    monkeypatch.setattr(hitl.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(hitl, "get_async_session_factory", lambda: _session_factory())
    monkeypatch.setattr(hitl, "RunRepository", lambda _s: FakeRunRepo(run))

    with pytest.raises(ValueError, match="does not match expected"):
        await hitl.resume_hitl_gate(run_id, "ideation", approved=True)


@pytest.mark.asyncio
async def test_resume_hitl_gate_missing_interrupt(monkeypatch):
    run_id = uuid4()
    run = FakeRun(run_id, RunStatus.AWAITING_IDEATION_APPROVAL.value)

    monkeypatch.setattr(hitl.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(hitl.settings, "database_url", "sqlite:///:memory:")
    monkeypatch.setattr(hitl, "get_async_session_factory", lambda: _session_factory())
    monkeypatch.setattr(hitl, "RunRepository", lambda _s: FakeRunRepo(run))
    monkeypatch.setattr(hitl, "get_graph", lambda: FakeGraph([]))

    with pytest.raises(ValueError, match="No pending ideation interrupt"):
        await hitl.resume_hitl_gate(run_id, "ideation", approved=True)


@pytest.mark.asyncio
async def test_resume_hitl_gate_success(monkeypatch):
    run_id = uuid4()
    run = FakeRun(run_id, RunStatus.AWAITING_IDEATION_APPROVAL.value)
    interrupt = FakeInterrupt({"gate": "ideation"})
    graph = FakeGraph([interrupt])

    monkeypatch.setattr(hitl.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(hitl.settings, "database_url", "sqlite:///:memory:")
    monkeypatch.setattr(hitl, "get_async_session_factory", lambda: _session_factory())
    monkeypatch.setattr(hitl, "RunRepository", lambda _s: FakeRunRepo(run))
    monkeypatch.setattr(hitl, "get_graph", lambda: graph)
    monkeypatch.setattr(hitl, "log_audit_event", lambda **_kw: None)
    monkeypatch.setattr(hitl, "log_hitl_event", lambda **_kw: None)

    result = await hitl.resume_hitl_gate(run_id, "ideation", approved=True, comment="ok")
    assert result.run_id == str(run_id)
    assert result.status == RunStatus.AWAITING_IDEATION_APPROVAL.value
    assert graph.invoked
