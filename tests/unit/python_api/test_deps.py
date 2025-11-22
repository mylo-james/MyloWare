from __future__ import annotations

from types import SimpleNamespace

import pytest

from apps.api import deps


def _clear_caches() -> None:
    for factory in (
        deps.get_database,
        deps.get_provider_cache,
        deps.get_kieai_client,
        deps.get_upload_post_client,
        deps.get_orchestrator_client,
        deps.get_mcp_client,
        deps.get_video_gen_service,
    ):
        try:
            factory.cache_clear()
        except AttributeError:
            pass


@pytest.fixture(autouse=True)
def reset_deps() -> None:
    _clear_caches()
    yield
    _clear_caches()


def test_get_database_uses_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    created: list[str] = []

    class FakeDatabase:
        def __init__(self, dsn: str) -> None:
            created.append(dsn)
            self.dsn = dsn

    monkeypatch.setattr(deps, "Database", FakeDatabase)
    fake_settings = SimpleNamespace(db_url="postgresql+psycopg://postgres:secret@db:5432/mw")
    monkeypatch.setattr(deps, "settings", fake_settings)

    db = deps.get_database()
    assert isinstance(db, FakeDatabase)
    assert created == [fake_settings.db_url]
    # cached result reused
    assert deps.get_database() is db


def test_get_kieai_client_reuses_provider_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    caches: list[str] = []

    class FakeCache:
        def __init__(self, path: str) -> None:
            caches.append(path)
            self.path = path

    built: dict[str, object] = {}
    fake_client = object()

    def fake_factory(settings: object, *, cache: object) -> object:
        built["settings"] = settings
        built["cache"] = cache
        return fake_client

    monkeypatch.setattr(deps, "ResponseCache", FakeCache)
    monkeypatch.setattr(deps, "build_kieai_client", fake_factory)
    fake_settings = SimpleNamespace(
        db_url="postgresql://localhost/db",
        provider_cache_dir="/tmp/providers",
        providers_mode="mock",
        kieai_api_key="test-key",
        kieai_base_url="https://kie.ai",
        kieai_signing_secret="secret",
        environment="local",
    )
    monkeypatch.setattr(deps, "settings", fake_settings)

    client = deps.get_kieai_client()
    assert client is fake_client
    assert caches == ["/tmp/providers"]
    assert built["settings"] is fake_settings
    assert built["cache"] is deps.get_provider_cache()
    # cached result reused
    assert deps.get_kieai_client() is client


def test_get_upload_post_client_reuses_provider_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    caches: list[str] = []

    class FakeCache:
        def __init__(self, path: str) -> None:
            caches.append(path)
            self.path = path

    captured: dict[str, object] = {}
    fake_client = object()

    def fake_factory(settings: object, *, cache: object) -> object:
        captured["settings"] = settings
        captured["cache"] = cache
        return fake_client

    monkeypatch.setattr(deps, "ResponseCache", FakeCache)
    monkeypatch.setattr(deps, "build_upload_post_client", fake_factory)
    fake_settings = SimpleNamespace(
        provider_cache_dir="/tmp/providers",
        providers_mode="mock",
        upload_post_api_key="upload-key",
        upload_post_base_url="https://api.upload-post.com/api",
        upload_post_signing_secret="secret",
        environment="local",
    )
    monkeypatch.setattr(deps, "settings", fake_settings)

    client = deps.get_upload_post_client()
    assert client is fake_client
    assert captured["settings"] is fake_settings
    assert captured["cache"] is deps.get_provider_cache()
    assert caches == ["/tmp/providers"]
