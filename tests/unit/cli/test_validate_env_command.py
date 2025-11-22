from __future__ import annotations

import json

import pytest

from cli import main as cli_main


def test_validate_env_reports_ok_with_settings_model(monkeypatch, capsys):
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")
    # Ensure the real Settings model is used.
    exit_code = cli_main.main(["validate", "env"])

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Environment looks OK" in out
    # Output should be JSON with a few key fields.
    report = json.loads(out.split("\n", 1)[1])
    assert "api_url" in report
    assert "db_url_present" in report


def test_validate_env_reports_validation_errors(monkeypatch, capsys):
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")

    def failing_get_settings():
        raise ValueError("invalid configuration")

    monkeypatch.setattr(cli_main, "get_settings", failing_get_settings)

    exit_code = cli_main.main(["validate", "env"])

    assert exit_code == 2
    out = capsys.readouterr().out
    assert "Environment validation failed" in out
    assert "invalid configuration" in out


def test_validate_env_fallback_checks_basic_env(monkeypatch, capsys):
    # Simulate absence of Settings model, falling back to basic env checks.
    monkeypatch.setenv("MWPY_SKIP_DOTENV", "1")
    monkeypatch.setattr(cli_main, "get_settings", None)
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.delenv("DB_URL", raising=False)

    exit_code = cli_main.main(["validate", "env"])

    assert exit_code == 2
    out = capsys.readouterr().out
    assert "Missing required env vars" in out
