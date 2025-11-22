# Run Integration Tests

**Audience:** Developers testing coordination flows  
**Outcome:** Verify agent handoffs work correctly  
**Time:** 5-10 minutes

---

## Overview

Integration tests verify that agents coordinate correctly via traces and memory.
The canonical tests now live in the Python stack and are executed with `pytest`.

**Test scope:**
- Trace creation and updates
- Agent handoffs
- Memory tagging
- Workflow progression

---

## Prerequisites

- Python environment set up as in `docs/README.md`
- Local stack running via `make up` (Postgres + API + Orchestrator)

---

## Steps (Python stack)

### 1. Run API Integration Suite

```bash
pytest -q tests/integration/python_api
```

This hits FastAPI endpoints (runs, webhooks, HITL) with the orchestrator mocked at the adapter boundary.

### 2. Run Mocked LangGraph Persona Graphs

```bash
pytest -q tests/integration/python_orchestrator
```

The suite compiles the production graphs with fakes, disables outbound network access, and asserts persona → provider parity in `providers_mode="mock"`.

### 3. Target a Specific API Test

```bash
pytest tests/integration/python_api/test_test_video_gen_pipeline.py -q
```

Handy when iterating on one pipeline or webhook.

### 4. Run With Real Providers (Optional)

```bash
export PROVIDERS_MODE=live
export LIVE_SMOKE=1
export USE_MOCK_PROVIDERS=false
export KIEAI_API_KEY=...
export SHOTSTACK_API_KEY=...
export UPLOAD_POST_API_KEY=...
export WEBHOOK_BASE_URL=https://<your-cloudflared-domain>
export DB_URL=postgresql+psycopg://...

pytest tests/integration/live/test_video_gen_live_smoke.py -q
```

This long-running smoke test uses the actual persona tools (kie.ai → Shotstack/FFmpeg → upload-post). It skips automatically when `LIVE_SMOKE` isn’t set.

---

## Test Categories

### API Pipeline Tests
**Files:** `tests/integration/python_api/*.py`

Tests:
- `/v1/runs/start` and `/v1/runs/{runId}/continue`
- HITL routes + webhook handlers
- Mocked provider interactions at the FastAPI boundary

### Orchestrator / LangGraph Tests
**Files:** `tests/integration/python_orchestrator/*.py`

Tests:
- Graph compilation + MemorySaver checkpoints
- Persona routing (Brendan, Iggy, Riley, Alex, Quinn) with mocked provider adapters
- HITL gates + persona context/tool invocations
- Network blocking (any stray HTTP attempt fails the harness)

### Live Provider Smoke
**Files:** `tests/integration/live/test_video_gen_live_smoke.py`

Tests:
- Full Test Video Gen pipeline with `PROVIDERS_MODE=live`
- Real kie.ai generation jobs (webhook HMAC + artifact updates)
- Shotstack render + FFmpeg normalization + upload-post publish flow
- Publish URL + artifact assertions for Quinn

---

## Writing Integration Tests

### Test Structure

```python
import uuid

from httpx import AsyncClient


async def test_brendan_to_iggy_handoff(api_client: AsyncClient) -> None:
    run_id = str(uuid.uuid4())

    # Start a run
    resp = await api_client.post(
        "/v1/runs/start",
        json={"project": "aismr", "prompt": "Generate ideas"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["runId"]

    # The orchestrator advances the workflow; assert final status
    run = await api_client.get(f"/v1/runs/{data['runId']}")
    assert run.status_code == 200
    payload = run.json()
    assert payload["status"] in {"running", "completed"}
```

### Best Practices

1. **Use fresh runs** - Create a new run per test.
2. **Clean up** - Let the test harness and containers tear down state; avoid manual DB resets.
3. **Exercise real orchestration flows** - Prefer hitting the real API + orchestrator rather than mocking internal clients.
4. **Assert artifacts** - Verify artifacts exist for each meaningful persona step.
5. **Test handoff chain** - Verify each persona can see upstream work via the API.

---

## Validation

✅ All integration tests pass  
✅ Trace coordination works  
✅ Memory tagging is correct  
✅ Handoffs update trace state  
✅ Agents can find upstream work

---

## Coverage Requirements

Integration tests should cover:
- [ ] Happy path (Brendan → Quinn) via `/v1/runs/start`
- [ ] Error handling paths (invalid prompts, provider failures)
- [ ] Completion (runs move to `published` with artifacts)
- [ ] Concurrency (multiple runs per project)

Current coverage: See `pytest --cov` commands in `docs/review/coverage-followups.md`.

---

## Next Steps

- [Add a Persona](add-a-persona.md) - Create new agents
- [Add a Project](add-a-project.md) - Define production types
- [Testing Guide](../07-contributing/testing.md) - Test strategy

---

## Troubleshooting

**Tests failing with "database not found"?**
- Ensure Docker is running
- Check `TEST_DB_USE_CONTAINER=1` is set
- Verify Testcontainers can access Docker socket

**Tests timeout?**
- Increase timeout in the specific test or fixture.
- Check database connection and container health.

**Memory not tagged with traceId?**
- Check `memory_store` calls include `metadata: { traceId }`
- Verify persona prompts enforce tagging

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.
