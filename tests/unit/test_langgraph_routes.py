from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from myloware.api.routes import langgraph as routes
from myloware.storage.models import RunStatus


@dataclass
class FakeRun:
    id: UUID
    status: str = RunStatus.PENDING.value
    current_step: str | None = None
    artifacts: dict[str, object] | None = None
    workflow_name: str = "aismr"
    input: str = "brief"
    user_id: str | None = None
    telegram_chat_id: str | None = None
    error: str | None = None


class RunStore:
    def __init__(self) -> None:
        self.runs: dict[UUID, FakeRun] = {}


class FakeSession:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


class FakeSessionCM:
    def __init__(self, session: FakeSession) -> None:
        self._session = session

    async def __aenter__(self) -> FakeSession:
        return self._session

    async def __aexit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        return None


class FakeRunRepo:
    def __init__(self, session: FakeSession, store: RunStore, recent_count: int = 0) -> None:
        self.session = session
        self._store = store
        self._recent_count = recent_count

    async def create_async(self, **kwargs):  # type: ignore[no-untyped-def]
        run = FakeRun(
            id=uuid4(),
            workflow_name=str(kwargs.get("workflow_name") or "aismr"),
            input=str(kwargs.get("input") or ""),
            user_id=kwargs.get("user_id"),
            telegram_chat_id=kwargs.get("telegram_chat_id"),
        )
        self._store.runs[run.id] = run
        return run

    async def get_async(self, run_id: UUID) -> FakeRun | None:
        return self._store.runs.get(run_id)

    async def update_async(self, run_id: UUID, **kwargs):  # type: ignore[no-untyped-def]
        run = self._store.runs.get(run_id)
        if not run:
            return None
        for k, v in kwargs.items():
            setattr(run, k, v)
        return None

    async def count_runs_since_async(self, _dt):  # type: ignore[no-untyped-def]
        return self._recent_count


class FakeGraph:
    def __init__(self) -> None:
        self.state = SimpleNamespace(values={}, interrupts=[], next=[])
        self.history: list[object] = []
        self.invocations: list[dict[str, object]] = []

    async def ainvoke(self, arg, *, config, durability):  # type: ignore[no-untyped-def]
        self.invocations.append({"arg": arg, "config": config, "durability": durability})
        return {"status": RunStatus.RUNNING.value, "current_step": "ideation"}

    async def aget_state(self, _config):  # type: ignore[no-untyped-def]
        return self.state

    async def aget_state_history(self, _config):  # type: ignore[no-untyped-def]
        for cp in self.history:
            yield cp


class FakeEngine:
    def __init__(self, graph: FakeGraph) -> None:
        self._graph = graph
        self.initialized = 0

    async def ensure_checkpointer_initialized(self) -> None:
        self.initialized += 1

    def get_graph(self) -> FakeGraph:
        return self._graph


def _fake_session_factory() -> FakeSession:
    return FakeSession()


def test_engine_from_request_sets_state() -> None:
    class DummyApp:
        def __init__(self):
            self.state = SimpleNamespace()

    class DummyRequest:
        def __init__(self):
            self.app = DummyApp()

    request = DummyRequest()
    engine = routes._engine_from_request(request)  # type: ignore[arg-type]
    assert isinstance(engine, routes.LangGraphEngine)
    assert request.app.state.langgraph_engine is engine


@pytest.mark.asyncio
async def test_start_run_success_returns_interrupt(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    graph = FakeGraph()

    class Intr:
        id = "i1"
        value = {"waiting_for": "hitl"}
        resumable = True

    graph.state = SimpleNamespace(
        values={"status": RunStatus.RUNNING.value}, interrupts=[Intr()], next=[]
    )

    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)

    # DB stubs
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    # Safety check stub
    monkeypatch.setattr(routes, "get_async_client", lambda: object())

    async def fake_check_brief_safety(*_a, **_kw):  # type: ignore[no-untyped-def]
        return SimpleNamespace(safe=True)

    monkeypatch.setattr(routes, "check_brief_safety", fake_check_brief_safety)
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _name: object())

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "hello"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "run_id" in body
    assert body["interrupt"]["id"] == "i1"


@pytest.mark.asyncio
async def test_approve_interrupt_no_interrupts_rejects(
    monkeypatch, async_client, api_headers
) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation", artifacts={})
    store.runs[run.id] = run

    graph = FakeGraph()
    graph.state = SimpleNamespace(values={}, interrupts=[], next=[])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/approve",
        headers=api_headers,
        json={"approved": False, "comment": "no"},
    )
    assert r.status_code == 400
    assert store.runs[run.id].status == RunStatus.RUNNING.value


@pytest.mark.asyncio
async def test_approve_interrupt_with_interrupt_invokes_graph(
    monkeypatch, async_client, api_headers
) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation", artifacts={})
    store.runs[run.id] = run

    graph = FakeGraph()

    class Intr:
        id = "intr"
        value = {"waiting_for": "hitl"}

    graph.state = SimpleNamespace(values={}, interrupts=[Intr()], next=["n1"])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/approve",
        headers=api_headers,
        json={"approved": True, "comment": "ok", "data": {"x": 1}},
    )
    assert r.status_code == 200
    assert graph.invocations


@pytest.mark.asyncio
async def test_reject_interrupt_requires_interrupt(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation")
    store.runs[run.id] = run

    graph = FakeGraph()
    graph.state = SimpleNamespace(values={}, interrupts=[], next=[])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/reject",
        headers=api_headers,
        json={"comment": "no"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_get_state_and_history(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value)
    store.runs[run.id] = run

    graph = FakeGraph()

    class Intr:
        id = "intr"
        value = {"waiting_for": "hitl"}

    graph.state = SimpleNamespace(values={"a": 1}, interrupts=[Intr()], next=["x"])

    class Cp:
        config = {"configurable": {"checkpoint_id": "cp-1"}}
        values = {"a": 1}
        next = ["n"]

    graph.history = [Cp()]
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.get(f"/v2/runs/{run.id}/state", headers=api_headers)
    assert r.status_code == 200
    assert r.json()["state"]["a"] == 1

    r = await async_client.get(f"/v2/runs/{run.id}/history", headers=api_headers)
    assert r.status_code == 200
    assert r.json() and r.json()[0]["checkpoint_id"] == "cp-1"


@pytest.mark.asyncio
async def test_start_run_langgraph_disabled(monkeypatch, async_client, api_headers) -> None:
    monkeypatch.setattr(routes.settings, "use_langgraph_engine", False)
    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "hello"},
    )
    assert r.status_code == 501


@pytest.mark.asyncio
async def test_start_run_safety_failure(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    graph = FakeGraph()
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "enable_safety_shields", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))
    monkeypatch.setattr(routes, "get_async_client", lambda: object())

    async def fake_check_brief_safety(*_a, **_kw):  # type: ignore[no-untyped-def]
        return SimpleNamespace(safe=False, category="policy", reason="nope")

    monkeypatch.setattr(routes, "check_brief_safety", fake_check_brief_safety)
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _name: object())

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "hello"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_start_run_budget_exceeded(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    graph = FakeGraph()
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "enable_safety_shields", False)
    monkeypatch.setattr(routes.settings, "max_runs_last_24h", 1)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(
        routes, "RunRepository", lambda session: FakeRunRepo(session, store, recent_count=1)
    )
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _name: object())

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "hello"},
    )
    assert r.status_code == 429


@pytest.mark.asyncio
async def test_start_run_missing_project(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    graph = FakeGraph()
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "enable_safety_shields", False)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    def _raise(_name):  # type: ignore[no-untyped-def]
        raise FileNotFoundError("missing")

    monkeypatch.setattr("myloware.config.projects.load_project", _raise)

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "missing", "brief": "hello"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_start_run_safety_system_error(monkeypatch, async_client, api_headers) -> None:
    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: FakeEngine(FakeGraph()))
    monkeypatch.setattr(routes, "get_async_client", lambda: object())

    async def fake_check(*_a, **_k):  # type: ignore[no-untyped-def]
        return SimpleNamespace(safe=False, category="system_error", reason="down")

    monkeypatch.setattr(routes, "check_brief_safety", fake_check)

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "unsafe"},
    )
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_start_run_safety_exception(monkeypatch, async_client, api_headers) -> None:
    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: FakeEngine(FakeGraph()))
    monkeypatch.setattr(routes, "get_async_client", lambda: object())

    async def fake_check(*_a, **_k):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr(routes, "check_brief_safety", fake_check)

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "unsafe"},
    )
    assert r.status_code == 500


@pytest.mark.asyncio
async def test_start_run_non_sqlite_initializes_checkpointer(
    monkeypatch, async_client, api_headers
) -> None:
    store = RunStore()
    graph = FakeGraph()
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "postgresql://localhost/db")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)

    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    monkeypatch.setattr(routes, "get_async_client", lambda: object())

    async def fake_check(*_a, **_kw):  # type: ignore[no-untyped-def]
        return SimpleNamespace(safe=True)

    monkeypatch.setattr(routes, "check_brief_safety", fake_check)
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _name: object())

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "hello"},
    )
    assert r.status_code == 200
    assert engine.initialized == 1


@pytest.mark.asyncio
async def test_get_run_success(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation")
    store.runs[run.id] = run

    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    resp = await async_client.get(f"/v2/runs/{run.id}", headers=api_headers)
    assert resp.status_code == 200
    assert resp.json()["run_id"] == str(run.id)


@pytest.mark.asyncio
async def test_approve_interrupt_non_iterable_fallback(
    monkeypatch, async_client, api_headers
) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation", artifacts={})
    store.runs[run.id] = run

    class Intr:
        id = "intr-1"
        value = {"waiting_for": "hitl"}

    class WeirdInterrupts:
        def __iter__(self):  # type: ignore[no-untyped-def]
            raise TypeError("no iter")

        def __getitem__(self, _idx):  # type: ignore[no-untyped-def]
            return Intr()

    class LocalGraph(FakeGraph):
        async def ainvoke(self, arg, *, config, durability):  # type: ignore[no-untyped-def]
            self.state = SimpleNamespace(values={}, interrupts=[], next=[])
            return {}

    graph = LocalGraph()
    graph.state = SimpleNamespace(values={}, interrupts=WeirdInterrupts(), next=["n1"])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/approve",
        headers=api_headers,
        json={"approved": True, "comment": "ok"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_approve_hitl_alias(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation", artifacts={})
    store.runs[run.id] = run

    graph = FakeGraph()

    class Intr:
        id = "intr"
        value = {"waiting_for": "hitl"}

    graph.state = SimpleNamespace(values={}, interrupts=[Intr()], next=["n1"])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/approve/hitl",
        headers=api_headers,
        json={"approved": True, "comment": "ok"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_resume_run_success(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(
        id=uuid4(), status=RunStatus.AWAITING_RENDER.value, current_step="wait_for_render"
    )
    store.runs[run.id] = run

    async def fake_resume_run(*_a, **_k):  # type: ignore[no-untyped-def]
        return {"action": "render", "message": "ok", "result": object()}

    monkeypatch.setattr("myloware.workflows.langgraph.workflow.resume_run", fake_resume_run)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/resume",
        headers=api_headers,
        json={"action": "render"},
    )
    assert r.status_code == 200
    payload = r.json()
    assert payload["action"] == "render"


@pytest.mark.asyncio
async def test_resume_run_repair_videos(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.AWAITING_VIDEO_GENERATION.value)
    store.runs[run.id] = run
    seen: dict[str, object] = {}

    async def fake_resume_run(*_a, **_k):  # type: ignore[no-untyped-def]
        seen.update(_k)
        return {"action": "repair-videos", "message": "ok", "result": object()}

    monkeypatch.setattr("myloware.workflows.langgraph.workflow.resume_run", fake_resume_run)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/resume",
        headers=api_headers,
        json={"action": "repair-videos", "video_indexes": [1, 3]},
    )
    assert r.status_code == 200
    assert seen.get("video_indexes") == [1, 3]


@pytest.mark.asyncio
async def test_reject_interrupt_non_iterable_fallback(
    monkeypatch, async_client, api_headers
) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value)
    store.runs[run.id] = run

    class Intr:
        id = "intr-1"
        value = {"waiting_for": "hitl"}

    class WeirdInterrupts:
        def __iter__(self):  # type: ignore[no-untyped-def]
            raise TypeError("no iter")

        def __getitem__(self, _idx):  # type: ignore[no-untyped-def]
            return Intr()

    class LocalGraph(FakeGraph):
        async def ainvoke(self, arg, *, config, durability):  # type: ignore[no-untyped-def]
            self.state = SimpleNamespace(values={}, interrupts=[], next=[])
            return {}

    graph = LocalGraph()
    graph.state = SimpleNamespace(values={}, interrupts=WeirdInterrupts(), next=["n1"])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/reject",
        headers=api_headers,
        json={"comment": "no"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_get_state_run_not_found(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.get(f"/v2/runs/{uuid4()}/state", headers=api_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_history_engine_disabled(monkeypatch, async_client, api_headers) -> None:
    monkeypatch.setattr(routes.settings, "use_langgraph_engine", False)
    r = await async_client.get(f"/v2/runs/{uuid4()}/history", headers=api_headers)
    assert r.status_code == 501


@pytest.mark.asyncio
async def test_start_run_graph_failure_marks_failed(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()

    class BoomGraph(FakeGraph):
        async def ainvoke(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError("boom")

    graph = BoomGraph()
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "enable_safety_shields", False)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))
    monkeypatch.setattr("myloware.config.projects.load_project", lambda _name: object())

    r = await async_client.post(
        "/v2/runs/start",
        headers=api_headers,
        json={"workflow": "aismr", "brief": "hello"},
    )
    assert r.status_code == 500
    assert store.runs
    failed_run = next(iter(store.runs.values()))
    assert failed_run.status == RunStatus.FAILED.value


@pytest.mark.asyncio
async def test_approve_interrupt_requires_id_for_multiple(
    monkeypatch, async_client, api_headers
) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation")
    store.runs[run.id] = run

    graph = FakeGraph()

    class Intr:
        id = "intr-1"
        value = {"waiting_for": "hitl"}

    graph.state = SimpleNamespace(values={}, interrupts=[Intr(), Intr()], next=[])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/approve",
        headers=api_headers,
        json={"approved": True},
    )
    assert r.status_code == 500


@pytest.mark.asyncio
async def test_approve_interrupt_unknown_id(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation")
    store.runs[run.id] = run

    graph = FakeGraph()

    class Intr:
        id = "intr-1"
        value = {"waiting_for": "hitl"}

    graph.state = SimpleNamespace(values={}, interrupts=[Intr()], next=[])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/approve",
        headers=api_headers,
        json={"approved": True, "interrupt_id": "unknown"},
    )
    assert r.status_code == 500


@pytest.mark.asyncio
async def test_reject_interrupt_unknown_id(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value, current_step="ideation")
    store.runs[run.id] = run

    graph = FakeGraph()

    class Intr:
        id = "intr-1"
        value = {"waiting_for": "hitl"}

    graph.state = SimpleNamespace(values={}, interrupts=[Intr()], next=[])
    engine = FakeEngine(graph)

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.post(
        f"/v2/runs/{run.id}/reject",
        headers=api_headers,
        json={"comment": "no", "interrupt_id": "unknown"},
    )
    assert r.status_code == 500


@pytest.mark.asyncio
async def test_get_run_not_found(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.get(f"/v2/runs/{uuid4()}", headers=api_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_resume_invalid_run_id(monkeypatch, async_client, api_headers) -> None:
    r = await async_client.post(
        "/v2/runs/not-a-uuid/resume",
        headers=api_headers,
        json={},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_resume_value_error(monkeypatch, async_client, api_headers) -> None:
    async def _fake_resume(*_a, **_kw):  # type: ignore[no-untyped-def]
        raise ValueError("bad")

    monkeypatch.setattr("myloware.workflows.langgraph.workflow.resume_run", _fake_resume)
    r = await async_client.post(
        f"/v2/runs/{uuid4()}/resume",
        headers=api_headers,
        json={},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_resume_run_not_found(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    async def _fake_resume(*_a, **_kw):  # type: ignore[no-untyped-def]
        return {"action": "auto", "message": "ok", "result": object()}

    monkeypatch.setattr("myloware.workflows.langgraph.workflow.resume_run", _fake_resume)

    r = await async_client.post(
        f"/v2/runs/{uuid4()}/resume",
        headers=api_headers,
        json={},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_history_handles_exception(monkeypatch, async_client, api_headers) -> None:
    store = RunStore()
    run = FakeRun(id=uuid4(), status=RunStatus.RUNNING.value)
    store.runs[run.id] = run

    class BadGraph(FakeGraph):
        async def aget_state_history(self, _config):  # type: ignore[no-untyped-def]
            if False:
                yield None
            raise RuntimeError("boom")

    engine = FakeEngine(BadGraph())

    monkeypatch.setattr(routes.settings, "use_langgraph_engine", True)
    monkeypatch.setattr(routes.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setattr(routes, "_engine_from_request", lambda _req: engine)
    monkeypatch.setattr(
        routes,
        "get_async_session_factory",
        lambda: (lambda: FakeSessionCM(_fake_session_factory())),
    )
    monkeypatch.setattr(routes, "RunRepository", lambda session: FakeRunRepo(session, store))

    r = await async_client.get(f"/v2/runs/{run.id}/history", headers=api_headers)
    assert r.status_code == 200
    assert r.json() == []
