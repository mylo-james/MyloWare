from __future__ import annotations

from types import SimpleNamespace

import pytest

from apps.api.services.test_video_gen.orchestrator import VideoGenService


class DummyDB:
    def __init__(self) -> None:
        self.created: list[dict[str, object]] = []
        self.updated: list[dict[str, object]] = []

    def create_run(self, **kwargs):  # type: ignore[no-untyped-def]
        self.created.append(kwargs)
        return "JOB-123"

    def create_artifact(self, **kwargs):  # type: ignore[no-untyped-def]
        self.created.append({"artifact": kwargs})

    def update_run(self, **kwargs):  # type: ignore[no-untyped-def]
        self.updated.append(kwargs)


def test_start_run_only_invokes_orchestrator(monkeypatch: pytest.MonkeyPatch) -> None:
    dummy_db = DummyDB()
    fake_orchestrator = SimpleNamespace(invocations=[])  # type: ignore[attr-defined]

    def fake_invoke(run_id: str, payload, **kwargs):  # noqa: ANN001
        fake_orchestrator.invocations.append((run_id, payload, kwargs))

    settings = SimpleNamespace(db_url="postgresql+psycopg://", rag_persona_prompts=False)

    service = VideoGenService(
        db=dummy_db,
        kieai=SimpleNamespace(),
        upload_post=SimpleNamespace(),
        orchestrator=SimpleNamespace(invoke=fake_invoke),
        mcp=None,
        webhook_base_url="http://localhost",
        settings=settings,
    )

    result = service.start_run(project="test_video_gen", run_input={}, options=None)

    assert fake_orchestrator.invocations, "Expected orchestrator.invoke to run"
    run_id, payload, kwargs = fake_orchestrator.invocations[-1]
    assert run_id == result["run_id"]
    assert payload["project"] == "test_video_gen"
    assert kwargs.get("background") is True
