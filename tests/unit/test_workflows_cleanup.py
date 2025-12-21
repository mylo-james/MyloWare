from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4


from myloware.storage.models import RunStatus
from myloware.workflows import cleanup


@dataclass
class FakeRun:
    id: object
    status: str
    created_at: datetime
    updated_at: datetime | None = None


class FakeSession:
    def __init__(self) -> None:
        self.commits = 0

    def commit(self) -> None:
        self.commits += 1


class FakeSessionCM:
    def __init__(self, session: FakeSession) -> None:
        self._session = session

    def __enter__(self) -> FakeSession:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        return None


class FakeRunRepo:
    def __init__(self, runs_by_status: dict[str, list[FakeRun]]) -> None:
        self._runs_by_status = runs_by_status
        self.updated: list[tuple[object, dict[str, object]]] = []

    def find_by_status_and_age(self, status: str, _cutoff: datetime) -> list[FakeRun]:
        return list(self._runs_by_status.get(status, []))

    def update(self, run_id: object, **kwargs):  # type: ignore[no-untyped-def]
        self.updated.append((run_id, kwargs))


def test_get_stuck_runs_handles_naive_datetime(monkeypatch) -> None:
    fixed_now = datetime(2025, 1, 1, tzinfo=timezone.utc)

    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[no-untyped-def]
            return fixed_now

    run_id = uuid4()
    stuck = FakeRun(
        id=run_id,
        status=RunStatus.AWAITING_VIDEO_GENERATION.value,
        created_at=fixed_now - timedelta(hours=2),
        updated_at=(fixed_now - timedelta(hours=1)).replace(tzinfo=None),  # naive
    )

    session = FakeSession()
    repo = FakeRunRepo({RunStatus.AWAITING_VIDEO_GENERATION.value: [stuck]})

    monkeypatch.setattr(cleanup, "datetime", FakeDatetime)
    monkeypatch.setattr(cleanup, "get_session", lambda: FakeSessionCM(session))
    monkeypatch.setattr(cleanup, "RunRepository", lambda _s: repo)

    runs = cleanup.get_stuck_runs(timeout_minutes=30)
    assert len(runs) == 1
    assert runs[0]["id"] == run_id
    assert runs[0]["status"] == RunStatus.AWAITING_VIDEO_GENERATION.value
    assert runs[0]["updated_at"].endswith("+00:00")
    assert runs[0]["stuck_for_minutes"] >= 60


def test_timeout_stuck_runs_dry_run_does_not_update(monkeypatch) -> None:
    fixed_now = datetime(2025, 1, 1, tzinfo=timezone.utc)

    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[no-untyped-def]
            return fixed_now

    run_id = uuid4()
    stuck = FakeRun(
        id=run_id,
        status=RunStatus.AWAITING_RENDER.value,
        created_at=fixed_now - timedelta(hours=2),
        updated_at=fixed_now - timedelta(hours=1),
    )

    session = FakeSession()
    repo = FakeRunRepo({RunStatus.AWAITING_RENDER.value: [stuck]})

    monkeypatch.setattr(cleanup, "datetime", FakeDatetime)
    monkeypatch.setattr(cleanup, "get_session", lambda: FakeSessionCM(session))
    monkeypatch.setattr(cleanup, "RunRepository", lambda _s: repo)

    out = cleanup.timeout_stuck_runs(timeout_minutes=30, dry_run=True)
    assert out == [run_id]
    assert repo.updated == []
    assert session.commits == 0


def test_timeout_stuck_runs_updates_and_commits(monkeypatch) -> None:
    fixed_now = datetime(2025, 1, 1, tzinfo=timezone.utc)

    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[no-untyped-def]
            return fixed_now

    run_id = uuid4()
    stuck = FakeRun(
        id=run_id,
        status=RunStatus.AWAITING_VIDEO_GENERATION.value,
        created_at=fixed_now - timedelta(hours=2),
        updated_at=(fixed_now - timedelta(hours=1)).replace(tzinfo=None),  # naive
    )

    session = FakeSession()
    repo = FakeRunRepo({RunStatus.AWAITING_VIDEO_GENERATION.value: [stuck]})

    monkeypatch.setattr(cleanup, "datetime", FakeDatetime)
    monkeypatch.setattr(cleanup, "get_session", lambda: FakeSessionCM(session))
    monkeypatch.setattr(cleanup, "RunRepository", lambda _s: repo)

    out = cleanup.timeout_stuck_runs(timeout_minutes=30, dry_run=False)
    assert out == [run_id]
    assert repo.updated and repo.updated[0][1]["status"] == RunStatus.FAILED.value
    assert session.commits == 1
