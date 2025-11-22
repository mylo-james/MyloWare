from __future__ import annotations

import argparse
from types import SimpleNamespace

import pytest

from cli import main as cli_main


def test_parse_project_key_accepts_aliases_and_rejects_unknowns() -> None:
    assert cli_main._parse_project_key("test_video_gen") == "test-video-gen"
    assert cli_main._parse_project_key("aismr") == "aismr"
    with pytest.raises(argparse.ArgumentTypeError):
        cli_main._parse_project_key("unknown-project")


def test_resolve_api_base_url_prefers_settings_then_env_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("API_BASE_URL", raising=False)
    monkeypatch.delenv("CLI_API_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("FLY_APP_NAME", raising=False)

    settings = SimpleNamespace(api_base_url="https://configured.example")
    monkeypatch.setattr(cli_main, "get_settings", lambda: settings)
    assert cli_main._resolve_api_base_url(None, None) == "https://configured.example"

    # If env hint provided, it overrides settings lookup
    base = cli_main._resolve_api_base_url(None, "staging")
    assert base == "https://myloware-api-staging.fly.dev"


def test_load_json_argument_errors_on_invalid_payload() -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        cli_main._load_json_argument("{not json}", "--input")


def test_coerce_bool_handles_truthy_and_falsy_values() -> None:
    assert cli_main._coerce_bool("true")
    assert cli_main._coerce_bool("1")
    assert not cli_main._coerce_bool("")
    assert not cli_main._coerce_bool(None)


class DummyResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:  # pragma: no cover - success path
        return None

    def json(self) -> dict[str, object]:
        return self._payload


def test_live_run_runner_start_run_uses_prompt_override(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = cli_main.LiveRunRunner(
        api_base_url="https://api.local",
        api_key="key",
        project_key="test-video-gen",
        prompt="Ship it",
        timeout=10,
        poll_interval=0.1,
        check_health=False,
        auto_approve=False,
    )

    calls: dict[str, object] = {}

    def fake_post(self, client, path: str, payload: dict[str, object]) -> DummyResponse:  # type: ignore[override]
        calls.update({"path": path, "payload": payload})
        return DummyResponse({"run_ids": ["run-xyz"]})

    monkeypatch.setattr(cli_main.LiveRunRunner, "_client_post", fake_post)
    monkeypatch.setattr(cli_main.LiveRunRunner, "_record_activity", lambda self, message, **kwargs: None)

    run_id = runner._start_run(client=object())

    assert run_id == "run-xyz"
    assert calls["path"] == "/v1/chat/brendan"
    payload = calls["payload"]
    assert isinstance(payload, dict)
    assert payload["message"] == "Ship it"
    assert payload["user_id"] == "mw-py-live-test_video_gen"


def test_parse_token_from_url_and_find_pending_gate() -> None:
    url = "https://api.local/approve?token=abc123&runId=run-9"
    assert cli_main.LiveRunRunner._parse_token_from_url(url) == "abc123"

    artifacts = [
        {"type": "hitl.request", "metadata": {"gate": "ideate"}},
        {"type": "hitl.request", "metadata": {"gate": "prepublish"}},
    ]
    assert cli_main.LiveRunRunner._find_pending_gate(artifacts, approved={"ideate"}) == "prepublish"


def test_live_run_runner_monitor_run_auto_approves_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = cli_main.LiveRunRunner(
        api_base_url="https://api.local",
        api_key="key",
        project_key="test-video-gen",
        timeout=5,
        poll_interval=0.0,
        check_health=False,
        auto_approve=True,
    )

    logs: list[str] = []

    def fake_record(self, message: str, *, echo: str | None = None, emit: bool = True) -> None:
        self.activity_log.append(message)
        logs.append(message)

    monkeypatch.setattr(cli_main.LiveRunRunner, "_record_activity", fake_record)

    run_responses = [
        DummyResponse({"status": "running", "artifacts": [{"type": "hitl.request", "metadata": {"gate": "ideate"}}]}),
        DummyResponse({"status": "completed", "artifacts": [], "result": {}}),
    ]
    approvals: list[tuple[str, dict[str, str] | None]] = []

    def fake_get(self, client, path: str, params: dict[str, str] | None = None) -> DummyResponse:  # type: ignore[override]
        if path.startswith("/v1/runs/"):
            return run_responses.pop(0)
        if path.startswith("/v1/hitl/link/"):
            return DummyResponse({"approvalUrl": "https://hitl.local/approve?token=tok-1"})
        if path.startswith("/v1/hitl/approve/"):
            approvals.append((path, params))
            return DummyResponse({"status": "approved"})
        raise AssertionError(f"Unexpected path {path}")

    monkeypatch.setattr(cli_main.LiveRunRunner, "_client_get", fake_get)

    final_state = runner._monitor_run(client=object(), run_id="run-99")

    assert final_state["status"] == "completed"
    assert approvals and approvals[0][0].endswith("/v1/hitl/approve/run-99/ideate")
    assert any("approved ideate gate" in entry for entry in runner.activity_log)


def test_live_run_runner_run_aggregates_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = cli_main.LiveRunRunner(
        api_base_url="https://api.local",
        api_key="key",
        project_key="test-video-gen",
        check_health=True,
    )

    calls: list[str] = []

    class FakeClient:
        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - nothing to clean
            return None

    monkeypatch.setattr(cli_main.httpx, "Client", lambda **_: FakeClient())
    monkeypatch.setattr(cli_main.LiveRunRunner, "_check_health", lambda self, client: calls.append("health"))
    monkeypatch.setattr(cli_main.LiveRunRunner, "_start_run", lambda self, client: "run-123")
    monkeypatch.setattr(
        cli_main.LiveRunRunner,
        "_monitor_run",
        lambda self, client, run_id: {"status": "completed", "project": "test_video_gen", "result": {"publishUrls": ["url"]}, "artifacts": []},
    )

    summary = runner.run()

    assert summary["runId"] == "run-123"
    assert summary["status"] == "completed"
    assert "health" in calls


def test_live_run_runner_approve_gate_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = cli_main.LiveRunRunner(
        api_base_url="https://api.local",
        api_key="key",
        project_key="test-video-gen",
    )

    def fake_get(self, client, path: str, params: dict[str, str] | None = None) -> DummyResponse:  # type: ignore[override]
        if path.startswith("/v1/hitl/link/"):
            return DummyResponse({"approvalUrl": None})
        raise AssertionError("approve path should not be reached")

    monkeypatch.setattr(cli_main.LiveRunRunner, "_client_get", fake_get)

    with pytest.raises(RuntimeError):
        runner._approve_gate(client=object(), run_id="run-1", gate="ideate")


def test_validate_env_uses_settings(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    fake_settings = SimpleNamespace(
        public_api_base="https://api.local",
        db_url="postgresql://user:pass@localhost/db",
        rag_persona_prompts=True,
        orchestrator_base_url="https://orch.local",
        enable_langchain_personas=True,
    )
    monkeypatch.setattr(cli_main, "get_settings", lambda: fake_settings)
    result = cli_main._validate_env(argparse.Namespace())
    captured = capsys.readouterr()
    assert result == 0
    assert "Environment looks OK" in captured.out


def test_validate_env_fallback_detects_missing(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    monkeypatch.setattr(cli_main, "get_settings", None)
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.delenv("DB_URL", raising=False)
    result = cli_main._validate_env(argparse.Namespace())
    captured = capsys.readouterr()
    assert result == 2
    assert "Missing required env vars" in captured.out


def test_validate_personas_warns_when_disabled(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    class FakeSettings:
        enable_langchain_personas = False
        providers_mode = "mock"

    monkeypatch.setenv("ENABLE_LANGCHAIN_PERSONAS", "0")
    monkeypatch.setattr(cli_main, "get_orchestrator_settings", lambda: FakeSettings())
    args = argparse.Namespace(project="test_video_gen")
    result = cli_main._validate_personas(args)
    captured = capsys.readouterr()
    assert result == 1
    assert "LangChain personas are disabled" in captured.err


def test_validate_config_invokes_smoke_checks(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    """CLI validate config should call orchestrator smoke checks and report success."""

    from apps.orchestrator import config_smoke as orch_config_smoke

    called: dict[str, object] = {}

    def fake_run_config_smoke(settings) -> None:  # type: ignore[no-untyped-def]
        called["settings"] = settings

    class FakeSettings:
        environment = "local"

    monkeypatch.setattr(orch_config_smoke, "run_config_smoke_checks", fake_run_config_smoke, raising=False)
    monkeypatch.setattr(cli_main, "get_orchestrator_settings", lambda: FakeSettings(), raising=False)

    result = cli_main._validate_config(argparse.Namespace())
    captured = capsys.readouterr()
    assert result == 0
    assert "Config smoke checks passed" in captured.out
    assert isinstance(called.get("settings"), FakeSettings)
