"""Unit tests for `myloware stack` CLI commands."""

from __future__ import annotations

from types import SimpleNamespace

from click.testing import CliRunner

from myloware.cli.main import cli


def test_stack_models_json(monkeypatch) -> None:
    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: object())
    monkeypatch.setattr("myloware.cli.stack.list_models", lambda _c: ["m1", "m2"])

    result = CliRunner().invoke(cli, ["stack", "models", "--json"])

    assert result.exit_code == 0
    assert "m1" in result.output
    assert '"count": 2' in result.output


def test_stack_models_table(monkeypatch) -> None:
    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: object())
    monkeypatch.setattr("myloware.cli.stack.list_models", lambda _c: ["m1", "m2"])

    result = CliRunner().invoke(cli, ["stack", "models"])

    assert result.exit_code == 0
    assert "Model ID" in result.output
    assert "m1" in result.output
    assert "Total: 2 models" in result.output


def test_stack_status_json_success(monkeypatch) -> None:
    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: object())
    monkeypatch.setattr(
        "myloware.cli.stack.verify_connection",
        lambda _c: {
            "success": True,
            "models_available": 2,
            "model_tested": "m1",
            "inference_works": True,
        },
    )

    result = CliRunner().invoke(cli, ["stack", "status", "--json"])

    assert result.exit_code == 0
    assert '"success"' in result.output
    assert "models_available" in result.output


def test_stack_status_text_success(monkeypatch) -> None:
    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: object())
    monkeypatch.setattr(
        "myloware.cli.stack.verify_connection",
        lambda _c: {
            "success": True,
            "models_available": 1,
            "model_tested": "m1",
            "inference_works": False,
        },
    )

    result = CliRunner().invoke(cli, ["stack", "status"])

    assert result.exit_code == 0
    assert "Connection verified" in result.output
    assert "Models available" in result.output
    assert "Inference works" in result.output
    assert "No" in result.output


def test_stack_status_text_failure(monkeypatch) -> None:
    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: object())
    monkeypatch.setattr(
        "myloware.cli.stack.verify_connection",
        lambda _c: {"success": False, "models_available": 3, "error": "boom"},
    )

    result = CliRunner().invoke(cli, ["stack", "status"])

    assert result.exit_code == 0
    assert "Connection failed" in result.output
    assert "Error" in result.output
    assert "Models available" in result.output


def test_stack_inspect_json(monkeypatch) -> None:
    class FakeInspect:
        def version(self) -> str:
            return "v1.2.3"

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(inspect=FakeInspect())
    )

    result = CliRunner().invoke(cli, ["stack", "inspect", "--json"])

    assert result.exit_code == 0
    assert "v1.2.3" in result.output


def test_stack_inspect_text(monkeypatch) -> None:
    class FakeInspect:
        def version(self) -> str:
            return "v1.2.3"

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(inspect=FakeInspect())
    )

    result = CliRunner().invoke(cli, ["stack", "inspect"])

    assert result.exit_code == 0
    assert "Llama Stack Version" in result.output
    assert "v1.2.3" in result.output


def test_stack_toolgroups_json(monkeypatch) -> None:
    class FakeToolgroups:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="tg-1", name="tools")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(toolgroups=FakeToolgroups())
    )

    result = CliRunner().invoke(cli, ["stack", "toolgroups", "--json"])

    assert result.exit_code == 0
    assert "tg-1" in result.output
    assert '"count": 1' in result.output


def test_stack_toolgroups_table(monkeypatch) -> None:
    class FakeToolgroups:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="tg-1", name="tools")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(toolgroups=FakeToolgroups())
    )

    result = CliRunner().invoke(cli, ["stack", "toolgroups"])

    assert result.exit_code == 0
    assert "tg-1" in result.output
    assert "Total:" in result.output


def test_stack_providers_json(monkeypatch) -> None:
    class FakeProviders:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="p-1", name="fake")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(providers=FakeProviders())
    )

    result = CliRunner().invoke(cli, ["stack", "providers", "--json"])

    assert result.exit_code == 0
    assert "p-1" in result.output
    assert '"count": 1' in result.output


def test_stack_providers_table(monkeypatch) -> None:
    class FakeProviders:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="p-1", name="fake")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(providers=FakeProviders())
    )

    result = CliRunner().invoke(cli, ["stack", "providers"])

    assert result.exit_code == 0
    assert "p-1" in result.output
    assert "Total:" in result.output


def test_stack_shields_list_json(monkeypatch) -> None:
    class FakeShields:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="shield-1", name="safety-net")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(shields=FakeShields())
    )

    result = CliRunner().invoke(cli, ["stack", "shields", "--json"])

    assert result.exit_code == 0
    assert "shield-1" in result.output
    assert '"count": 1' in result.output


def test_stack_shields_list_table(monkeypatch) -> None:
    class FakeShields:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="shield-1", name="safety-net")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(shields=FakeShields())
    )

    result = CliRunner().invoke(cli, ["stack", "shields"])

    assert result.exit_code == 0
    assert "shield-1" in result.output
    assert "Total:" in result.output


def test_stack_vector_dbs_list_json(monkeypatch) -> None:
    class FakeVectorStores:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="vs-1", name="kb")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client",
        lambda: SimpleNamespace(vector_stores=FakeVectorStores()),
    )

    result = CliRunner().invoke(cli, ["stack", "vector-dbs", "list", "--json"])

    assert result.exit_code == 0
    assert "vs-1" in result.output
    assert '"count": 1' in result.output


def test_stack_vector_dbs_list_table(monkeypatch) -> None:
    class FakeVectorStores:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="vs-1", name="kb")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client",
        lambda: SimpleNamespace(vector_stores=FakeVectorStores()),
    )

    result = CliRunner().invoke(cli, ["stack", "vector-dbs", "list"])

    assert result.exit_code == 0
    assert "vs-1" in result.output
    assert "Total:" in result.output


def test_stack_datasets_json(monkeypatch) -> None:
    class FakeDatasets:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="ds-1", name="eval")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(datasets=FakeDatasets())
    )

    result = CliRunner().invoke(cli, ["stack", "datasets", "--json"])

    assert result.exit_code == 0
    assert "ds-1" in result.output
    assert '"count": 1' in result.output


def test_stack_datasets_table(monkeypatch) -> None:
    class FakeDatasets:
        def list(self):  # type: ignore[no-untyped-def]
            return [SimpleNamespace(id="ds-1", name="eval")]

    monkeypatch.setattr(
        "myloware.cli.stack.get_sync_client", lambda: SimpleNamespace(datasets=FakeDatasets())
    )

    result = CliRunner().invoke(cli, ["stack", "datasets"])

    assert result.exit_code == 0
    assert "ds-1" in result.output
    assert "Total:" in result.output


def test_stack_vector_dbs_register_auto_provider_text(monkeypatch) -> None:
    from myloware.cli import stack as stack_cli

    create_calls = {}

    class FakeVectorStores:
        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            create_calls["kwargs"] = kwargs
            return SimpleNamespace(id="vs-1", name=kwargs.get("name"))

    fake_client = SimpleNamespace(vector_stores=FakeVectorStores())
    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: fake_client)
    monkeypatch.setattr(stack_cli.settings, "milvus_uri", "localhost:19530")

    result = CliRunner().invoke(
        cli,
        [
            "stack",
            "vector-dbs",
            "register",
            "my-store",
            "--embedding-model",
            "foo-model",
        ],
    )

    assert result.exit_code == 0
    assert "Vector DB created" in result.output
    assert create_calls["kwargs"]["extra_body"]["provider_id"] == "milvus"


def test_stack_chat_json(monkeypatch) -> None:
    class FakeChatCompletions:
        def create(self, *, model, messages, stream=False):  # type: ignore[no-untyped-def]
            assert model == "m1"
            assert stream is False
            assert messages == [{"role": "user", "content": "ping"}]
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="pong"))]
            )

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=FakeChatCompletions()))

    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: fake_client)

    result = CliRunner().invoke(cli, ["stack", "chat", "ping", "--model", "m1", "--json"])

    assert result.exit_code == 0
    assert "pong" in result.output


def test_stack_chat_text(monkeypatch) -> None:
    class FakeChatCompletions:
        def create(self, *, model, messages, stream=False):  # type: ignore[no-untyped-def]
            assert model == "m1"
            assert stream is False
            assert messages == [{"role": "user", "content": "ping"}]
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="pong"))]
            )

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=FakeChatCompletions()))
    monkeypatch.setattr("myloware.cli.stack.get_sync_client", lambda: fake_client)

    result = CliRunner().invoke(cli, ["stack", "chat", "ping", "--model", "m1"])

    assert result.exit_code == 0
    assert "Model" in result.output
    assert "pong" in result.output
