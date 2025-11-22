# Testing Guide

**Audience:** Contributors writing or updating tests  
**Outcome:** Know how to run tests, raise coverage, and follow the Brendan‑first TDD workflow.

---

## Commands (TL;DR)

```bash
# Fast path – unit + mocked integration tests
make test

# Canonical coverage run (writes coverage.json + python-coverage.xml)
make test-coverage

# Optional overrides
PYTEST_TARGETS="tests/unit/python_api tests/unit/python_orchestrator tests/integration/python_orchestrator" make test
COVERAGE_FAIL_UNDER=80 make test-coverage

# Security scan (dependency audit)
make security
```

- `make test-coverage` is the single source of truth. It runs the same suites as `make test`, enforces the coverage gate, and regenerates `coverage.json` + `python-coverage.xml` for CI artifacts.
- CI calls the exact same command; keep it green locally before opening a PR.
- `make security` runs `pip-audit` against your current environment. CI should treat high‑severity findings as build failures.

---

## Current Coverage Baseline (2025‑11‑12)

| Scope                      | Coverage |
| -------------------------- | -------- |
| Overall (key packages)     | 82.0 %   |
| `apps/api`                 | 80.5 %   |
| `apps/orchestrator`        | 80.0 %   |
| `adapters` (provider libs) | 89.0 %   |

Source: `coverage.json` produced by `make test-coverage` on 2025‑11‑14 (local venv, Python 3.11).

---

## Targets & Gate Plan

1. **Done:** Maintained the original `COVERAGE_FAIL_UNDER=50` gate while bootstrapping tests.  
2. **Done:** Raised the gate to `COVERAGE_FAIL_UNDER=70` during the wide adapter + orchestrator sweep.  
3. **Now:** Overall + per‑package coverage (`apps/api`, `apps/orchestrator`, `adapters`) are ≥80 %; the gate is set to 80 locally and in CI via `COVERAGE_FAIL_UNDER=80`.

Call out deltas in PRs if coverage moves more than ±1 %.

---

## Test Types

| Layer | Location | Notes |
| --- | --- | --- |
| Unit | `tests/unit/**` (e.g., `tests/unit/python_api`, `tests/unit/python_orchestrator`, `tests/unit/libs`, `tests/unit/cli`, `tests/unit/adapters`, `tests/unit/mcp`, etc.) | Small, isolated behaviours. Every new endpoint, persona node, adapter, or CLI command must land at least one unit test. |
| Contract | `tests/unit/adapters/test_*_contract.py` | Verifies HTTP shape (URL, headers, payload, idempotency keys) for kie.ai, Shotstack, and upload-post clients. These tests gate any adapter changes before the graph touches them. |
| API integration | `tests/integration/python_api/**` | FastAPI + orchestrator happy paths with persona tools mocked at the adapter boundary. Ensures `/v1/runs/*`, `/v1/webhooks/*`, and HITL routes stay wired. |
| Mocked persona graphs | `tests/integration/python_orchestrator/*.py` | Builds the **real** LangGraph graphs with `MemorySaver` + the `MockGraphHarness`. All adapter calls are replaced with deterministic fakes and **any network access fails fast**. These runs prove graph parity in `providers_mode="mock"`. |
| Live smoke | `tests/integration/live/test_video_gen_live_smoke.py` | Opt-in verification that personas hit real providers. Requires `LIVE_SMOKE=1`, `PROVIDERS_MODE=live`, real secrets, and a webhook tunnel. Fails if publish URLs/artifacts are missing. |
| Performance | `tests/performance/**` | Optional perf/load checks. Useful for releases but never gates PRs. |
| CLI smoke | `tests/unit/cli/**`, optionally subprocess-based | Exercises `mw-py demo`, `mw-py live-run`, env validation, and evidence helpers. |

---

## Test Database

Python tests default to the Postgres container defined in `infra/docker-compose.yml`.

```bash
make up
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
make test
```

Use a dedicated Postgres service in CI and set `DB_URL` accordingly before running the suite.

---

## Writing & Structuring Tests

- Organize files as `tests/<layer>/<package>/test_<module>.py`.
- Use descriptive test names (`test_cli_demo_happy_path`, not `test_cli`).
- Prefer fixtures/fakes over global patches. Keep persona/project JSON fixtures close to tests.
- TDD workflow:
  1. Add or update a test that fails with the current implementation.
  2. Implement the code change.
  3. Rerun `make test` (fast) and `make test-coverage` before pushing.

### Example (Async FastAPI route)

```python
import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_runs_api_requires_prompt(api_app: AsyncClient) -> None:
    resp = await api_app.post("/v1/runs/start", json={"project": "aismr", "input": {}})
    assert resp.status_code == 422
```

---

## Mocking Guidelines

- Use `pytest-mock` or `unittest.mock` to stub external services (kie.ai, Shotstack, upload-post, FFmpeg) and to simulate failure modes.
- Never mock the database layer—use the temporary Postgres instance + transactional fixtures.
- For CLI tests, monkeypatch HTTP clients or orchestrator adapters so demo commands stay hermetic.

```python
from unittest.mock import AsyncMock

def test_kieai_client_handles_retry(mocker):
    client = KieAIClient(api_key="test")
    mock_request = mocker.patch(
        "adapters.ai_providers.kieai.client.httpx.AsyncClient.post",
        new=AsyncMock(),
    )
    mock_request.return_value.json.return_value = {"job_id": "abc"}
    result = asyncio.run(client.submit_job(prompt="hello"))
    assert result.job_id == "abc"
```

---

## Provider Modes & Live Smoke

- `PROVIDERS_MODE=mock` (default) tells the adapter factories to return deterministic fakes. Mocked LangGraph tests enforce **zero network** in this mode.
- `PROVIDERS_MODE=live` flips those factories to real kie.ai, Shotstack, and upload-post clients. Only use it with Fly/staging secrets and a webhook tunnel.

**Mocked LangGraph runs**

```bash
pytest -q tests/integration/python_orchestrator
```

This compiles the production graphs with `MemorySaver`, swaps in fake adapters, blocks outbound HTTP, and asserts personas emit artifacts/publish URLs while `providers_mode="mock"` is active.

**Live provider smoke (opt-in)**

```bash
export PROVIDERS_MODE=live
export LIVE_SMOKE=1
export USE_MOCK_PROVIDERS=false   # keep API + CLI honest
export KIEAI_API_KEY=...
export SHOTSTACK_API_KEY=...
export UPLOAD_POST_API_KEY=...
export WEBHOOK_BASE_URL=https://<your-cloudflared-domain>
export DB_URL=postgresql+psycopg://...

pytest tests/integration/live/test_video_gen_live_smoke.py -q
```

The test waits (default 15 minutes, override via `LIVE_SMOKE_MAX_WAIT`) for Quinn to publish real URLs, then checks artifact types + webhook evidence. Leave `LIVE_SMOKE` unset (CI default) to skip.

**CI option:** A manual workflow (`Live Smoke (manual)`) exists under GitHub Actions. Set the `LIVE_SMOKE_ENABLED` secret to `1`, configure all `LIVE_SMOKE_*` secrets (provider keys, DB URL, webhook base), then trigger the workflow when you want a hosted verification run.

---

## Test Data

- Seed data lives under `data/projects/*` and `data/personas/*`.
- Use helper fixtures where available (`tests/unit/python_orchestrator/hitl_helpers.py`).
- Keep KB/artifact fixtures small so `coverage run` stays fast.

---

## Coverage Artifacts

- `coverage.json` — canonical machine-readable output (used by implementation-plan baseline, docs, dashboards).
- `python-coverage.xml` — uploaded by CI for PR annotations.
- To inspect locally:

```bash
make test-coverage
python - <<'PY'
import json
with open('coverage.json') as f:
    data = json.load(f)
print(data['meta'])
PY
```

Keep these artifacts out of git; they’re ignored by default.

---

## Checklist Before PR

- [ ] `make lint` and `make test` pass locally.
- [ ] `make test-coverage` ≥ gate (currently 80%).
- [ ] `pytest -q tests/integration/python_orchestrator` passes when persona graphs/tools change (enforces network blocking).
- [ ] Added/updated tests for every code change:
  - [ ] At least one unit test for every new endpoint, orchestrator node, or adapter.
  - [ ] At least one integration test (or update to an existing one) for any new cross-service behaviour or pipeline.
- [ ] Coverage deltas noted in PR description if > ±1 %.
- [ ] Docs updated when test strategy changes (this file + `AGENTS.md`).
