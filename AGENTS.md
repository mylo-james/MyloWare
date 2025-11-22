# Agent Development Guide

Quick reference for AI and human agents working in the MyloWare repository.

---

## Mission

Build a **multi-agent, production-first AI Studio** where:

- Supervisor (Brendan) coordinates production runs via `runId` in a LangGraph state graph
- Specialist agents (Iggy, Riley, Alex, Quinn) execute persona-scoped tasks
- Artifacts tagged by `runId` provide coordination fabric and lineage
- Mandatory HITL gates ensure quality after ideate and before publish

**Current Status:** v1.0 baseline complete - multi-agent LangGraph orchestrator with two production pipelines (Test Video Gen, AISMR), FastAPI gateway, full observability, and 82% test coverage.

---

## Quick Start for Agents

Read in this order:
1. **[README.md](README.md)** — Project overview, quick start, and key features
2. **[ROADMAP.md](ROADMAP.md)** — Future direction and planned milestones
3. **[docs/architecture.md](docs/architecture.md)** — Stack, APIs, data models, and controls
4. **[docs/development-cycle.md](docs/development-cycle.md)** — Core workflow: Observe → Diagnose → Fix → Verify → Document
5. **[docs/stories/](docs/stories/)** — Detailed implementation stories and acceptance criteria

---

## Development Workflow: Observe → Diagnose → Fix → Verify → Document

**Our development cycle is simple: watch it run, find the root cause, fix it, prove it works, write it down.**

### 1. 👀 OBSERVE: Start a run and watch what happens

**Don't assume what's broken. Watch a real run and see what actually happens.**

```bash
# Start a test run
curl -X POST https://myloware-api-staging.fly.dev/v1/runs/start \
  -H "x-api-key: $API_KEY" \
  -d '{"project": "test_video_gen", "input": "Generate test videos"}'

# Watch logs in real-time
flyctl logs -c fly.orchestrator.toml -f | rg "335a193f"

# Check LangSmith traces
open "https://smith.langchain.com/o/.../projects/p/myloware-orchestrator-staging"

# Query run state
curl https://myloware-api-staging.fly.dev/v1/runs/335a193f -H "x-api-key: $API_KEY"
```

**Key questions:**
- Did the agent call the right tools?
- Did it research before acting?
- Did it get stuck in a loop?
- Did it skip required steps?
- What does LangSmith show about its reasoning?

### 2. 🔍 DIAGNOSE: Find the root cause, not symptoms

**Trace backwards from the symptom to the underlying issue.**

```bash
# Check LangSmith for tool calls and reasoning
# Look for: which tools were called, in what order, what was the output

# Review agent's prompt and expectations
cat data/personas/riley/prompt.md
cat data/projects/test_video_gen/agent-expectations.json | jq '.riley'

# Check tool registration and filtering
grep -A 20 "_register_persona_tools" apps/orchestrator/persona_nodes.py

# Inspect state at point of failure
psql $DB_URL -c "SELECT * FROM runs WHERE id = '335a193f'"
```

**Key questions:**
- What was the agent trying to do?
- Why did it fail or get stuck?
- Is this a prompt issue, tool issue, or data issue?
- Is there a silent fallback hiding the real problem?
- What would make this fail-fast instead of failing silently?

### 3. 🔧 FIX: Address root cause, remove fallbacks, fail-fast

**Fix the underlying issue, not the symptom. No silent fallbacks.**

```python
# ❌ BEFORE: Silent fallback hides the problem
def _load_allowed_tools(persona: str, project: str) -> list[str]:
    expectations = _load_agent_expectations(project)
    persona_config = expectations.get(persona, {})
    return persona_config.get("tools", ["memory_search"])  # Silent fallback!

# ✅ AFTER: Fail-fast makes the problem obvious
def _load_allowed_tools(persona: str, project: str) -> list[str]:
    expectations = _load_agent_expectations(project)
    if persona not in expectations:
        raise ValueError(f"No expectations found for {persona} in {project}")
    return expectations[persona]["tools"]
```

**Key principles:**
- **Fail-fast**: Errors should be loud and immediate
- **No silent fallbacks**: If something's wrong, raise an exception
- **Validate early**: Check inputs before processing
- **Test the fix**: Add a unit test to prevent regression

### 4. ✅ VERIFY: Prove the fix works with a real run

**Deploy and watch a complete end-to-end run.**

```bash
# Deploy fix
flyctl deploy -c fly.orchestrator.toml --strategy immediate

# Start fresh run
curl -X POST https://myloware-api-staging.fly.dev/v1/runs/start \
  -H "x-api-key: $API_KEY" \
  -d '{"project": "test_video_gen", "input": "Generate test videos"}'

# Watch it complete
flyctl logs -c fly.orchestrator.toml -f | rg "9bc36a33"

# Verify in LangSmith
# ✅ Check: Riley called memory_search (3x) → submit_generation_jobs_tool → wait → transfer
# ✅ Check: Alex called render_video_timeline_tool once (template auto-build) → transfer
# ✅ Check: Quinn called memory_search (1x) → publish_to_tiktok_tool
```

**Key questions:**
- Did the run complete successfully?
- Did the agent call the right tools in the right order?
- Are artifacts created with correct metadata?
- Does LangSmith show the expected reasoning?

### 5. 📝 DOCUMENT: Write it down with evidence

**Create a summary with run IDs, LangSmith links, and what changed.**

```markdown
# Riley Contract Regression Fix

## Problem
Riley stuck in loop (run `335a193f`), only calling memory_search.

## Root Cause
Incorrect file path + silent fallback = tools not loaded.

## Solution
1. Fixed path: `/app/data/projects`
2. Removed fallback: fail-fast if expectations missing
3. Added contract validation

## Verification
Run `9bc36a33` completed successfully.
LangSmith: https://smith.langchain.com/.../9bc36a33

## Files Changed
- `apps/orchestrator/persona_context.py` (path fix)
- `apps/orchestrator/persona_nodes.py` (contract validation)
- `implementation-plan.md` (updated status)
```

---

### Local Development Commands

```bash
# Boot local stack (Postgres+pgvector, Redis, API, Orchestrator, Prom, Grafana)
docker compose -f infra/docker-compose.yml up -d

# Rebuild langchain-enabled images whenever dependencies change
docker compose -f infra/docker-compose.yml build api orchestrator

# Run tests
make test

# Full suite with coverage (generates coverage.json)
make test-coverage

# Lint/format
ruff check . && black --check .

# Apply DB migrations (Alembic)
alembic upgrade head

# Tail logs
docker compose -f infra/docker-compose.yml logs -f api orchestrator
```

After containers restart, the orchestrator will emit a `LangChain persona runtime configuration` log line. Confirm it shows `langchain_available: true` and `enable_langchain_personas: true` before approving HITL gates; otherwise rebuild the images or export `ENABLE_LANGCHAIN_PERSONAS=true`.

### Debugging HITL approvals and Brendan tools

When production HITL approvals or Telegram flows misbehave, follow this playbook:

1. **Source real env vars** – If `.env.real` is a 1Password pipe, run `python infra/scripts/materialize_env.py --src .env.real --dest .env` so shells and Docker builds don’t hang when exporting secrets.
2. **Verify Fly secrets** – Re-sync API + orchestrator secrets whenever `.env` changes by running `bash infra/scripts/bootstrap_staging_secrets.sh`. Only real secrets live in `.env`; non-secret config is derived from the app name.
3. **Run through Telegram/Fly domain** – Use `https://myloware-api-staging.fly.dev` for authenticated calls; the Cloudflare tunnel strips `x-api-key` unless configured otherwise.
4. **Inspect logs/live traces**:
   ```bash
   flyctl logs -c fly.api.toml --no-tail | rg 'telegram'
   flyctl logs -c fly.orchestrator.toml --no-tail | rg 'approve gate'
   ```
   Watch LangSmith for `brendan-chat` traces to see which tools were invoked (e.g., `list_my_runs`, `approve_hitl_gate`).
5. **Cloudflare tunnel health** – The branded domain (`myloware-api.mjames.dev`) rides through `cloudflared`. If Telegram hits that domain and gets 401/connection refused, check `docker compose ... logs -f cloudflared`. The ingress in `cloudflared/config.yml` must point to `https://myloware-api-staging.fly.dev` with `httpHostHeader/originServerName` so headers reach Fly. To refresh: edit the config, then `docker compose --env-file .env -f infra/docker-compose.yml restart cloudflared`.
6. **Confirm provider allowlists** – If approvals return 500 before the orchestrator runs, tail the API logs (`flyctl logs -c fly.api.toml -n | rg 'UploadPostClient base_url'`). A `disallows host` ValueError means someone overrode the derived upload-post base URL. Staging defaults to `api.upload-post.dev`; prod uses `api.upload-post.com`. Avoid manual overrides unless you know the allowlist value.
7. **Point orchestrator at the Fly API host** – The orchestrator now derives its API base URL from the Fly app name. Only override `API_BASE_URL` if you are intentionally pointing at a different API host; otherwise leave it unset so the default remains `https://myloware-api-staging.fly.dev`.
8. **Approve gates via CLI** – When Brendan’s auto-approval times out, confirm `/v1/hitl/approve/{runId}/{gate}` works by curling the Fly domain with the API key. Brendan’s tool now retries with a 3 s timeout and logs the attempt count (`apps/orchestrator/brendan_agent.py`).
9. **Capture evidence** – After a successful run, record the run ID, publish URL, LangSmith link, and artifacts in `state-of-the-repo.md` so the next agent knows the environment is live-ready.

Deploy (Fly.io):
```bash
# Set secrets from 1Password and deploy
flyctl secrets set API_KEY=... DB_URL=... SENTRY_DSN=... LANGSMITH_API_KEY=...
flyctl deploy
```

### CLI usage (mw-py)

Use the Python CLI directly from your virtualenv:

```bash
# Environment checks
mw-py validate env

# Ingest personas, projects, guardrails, workflows
mw-py ingest run
mw-py ingest run --dry-run

# Knowledge base (manual ingestion for MVP)
mw-py kb ingest --dir data/kb/ingested

# Database helpers
mw-py db vector ensure-extension
mw-py retention prune --dry-run
```

Notes:
- Prefer `mw-py` over ad-hoc Python scripts; it keeps flags and env handling consistent.
- KB ingestion is manual for now—see [docs/03-how-to/kb-ingestion.md](docs/03-how-to/kb-ingestion.md) for the workflow and verification steps.

### Enabling Personas Locally

LangChain personas (Riley → Alex → Quinn) are disabled by default on local Compose
runs so you can inspect the observer path without calling provider mocks. When
you need them to execute tools:

1. Set `ENABLE_LANGCHAIN_PERSONAS=true` in `.env` (or export it in your shell).
2. Restart the stack: `docker compose -f infra/docker-compose.yml down && docker compose -f infra/docker-compose.yml up -d`.
3. Run `mw-py validate personas --project test_video_gen` (or `aismr`) to confirm the flag is active before approving HITL gates.

The same command will mention when you accidentally left personas off, which
would otherwise leave runs stuck in observation-only mode.

---

## Orchestration Pattern (LangGraph State Graph)

1. Inbound → API (FastAPI) via Telegram/Webhook/HTTP → `runId` created or continued
2. Supervisor (Brendan) decides: run vs clarify vs decline (thresholds: run ≥ 0.70, clarify 0.40–0.69)
3. Persona nodes execute with least-privilege tools; outputs stored as artifacts
4. HITL gates: mandatory after ideate (Iggy) and before publish (Quinn)
5. Production (Riley → Alex) uses kie.ai webhooks → Shotstack render → FFmpeg normalization
6. Publisher (Quinn) uses upload-post (TikTok MVP); returns canonical URL; run completes

All steps are checkpointed by LangGraph; runs are observable end-to-end (LangSmith + OTel).

---

## Run Coordination

Every production run has a unique `runId`. Agents coordinate by:

1. Load context: retrieve artifacts and prior outputs by `runId`
2. Execute work: follow project specs; enforce persona tool allowlists
3. Store outputs: persist structured artifacts with lineage and checksums
4. Advance graph: proceed or wait for HITL gate approvals

Key endpoints:
- POST `/v1/runs/start` — Start a run for project: `test_video_gen|aismr`
- POST `/v1/runs/{runId}/continue` — Continue/resume
- GET `/v1/hitl/approve/{runId}/{gate}` — Approve `ideate|prepublish` (signed link)

---

## Agent Tools & Adapters

Persona agents use LangChain tools + thin adapters (in `adapters/`):

- **Retrieval (pgvector)**: scoped by project/persona/run; dedupe and provenance tracking
- **kie.ai**: async job submit; webhook-based completion; retries with backoff
- **Shotstack**: timeline JSON, overlays/text/LUTs/motion templates; FFmpeg normalization post-pass
- **upload-post**: publish to TikTok; canonical URL returned and stored

Shared policies:
- Tool p95 ≤ 2s SLO; publish p95 ≤ 30s (webhooks)
- Idempotency keys on webhooks; HMAC `X-Signature` over raw payload; replay window ±5m

---

## HITL (Human-in-the-Loop)

Mandatory gates:
- After ideation (Iggy) → approve `ideate` before scripts
- Before publish (Quinn) → approve `prepublish` before posting

Approvals are signed links; audit logs capture actor IP and timestamp.

---

## Observability

- LangSmith: LLM traces and dataset evals per project
- Prometheus/Grafana: dashboards for tool p95s, publish p95, error rates, queue depth
- Sentry: error tracking and alerting
- Sampling: traces 100% errors/10% success; logs 100% warn+error/10% info; metrics 100%

---

## Security

- API keys for internal endpoints; per-key rate limits
- Webhooks: HMAC-SHA256 `X-Signature` + `X-Request-Id` + `X-Timestamp`; idempotency cache 24h
- SSRF defenses: domain allowlists, timeouts, content-type and size caps
- Secrets: managed in 1Password; injected into Fly; quarterly rotation target (post-MVP)

---

## Data & Retention

Artifacts and webhook events are stored in Postgres:
- `artifacts(runId, type, url, checksum, metadata, createdAt)`
- `webhook_events(idempotencyKey, provider, headers, rawPayload, signatureStatus, receivedAt)`

Retention:
- Artifacts/checkpoints: 90 days; webhook payloads: 14 days; logs: 30 days
- Backups: nightly; RPO 24h; RTO 2h; weekly retention for 4 weeks

---

## Common Commands

Local:
```bash
# Start local stack
docker compose -f infra/docker-compose.yml up -d

# Run tests
pytest -q

# Lint/format
ruff check . && black --check .
```

Migrations & data:
```bash
# Apply latest migrations
alembic upgrade head

# Create a new migration (after model changes)
alembic revision -m "add socials tables"
```

Deploy:
```bash
flyctl secrets set API_KEY=... DB_URL=... SENTRY_DSN=... LANGSMITH_API_KEY=...
flyctl deploy
```

---

## Documentation Index

**Start here:** [README.md](README.md) — Project overview and quick start

**Core references:**
- [docs/architecture.md](docs/architecture.md) — System design, APIs, data models, security
- [docs/development-cycle.md](docs/development-cycle.md) — Development workflow and best practices
- [ROADMAP.md](ROADMAP.md) — Future features and release timeline
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute

---

## Coverage Requirements

- Overall and per-package (`apps/api`, `apps/orchestrator`, `adapters`/provider libs) coverage ≥ 80% (currently ~82% overall across these packages).
- Run `make test-coverage` locally before PRs; CI runs the same command with `COVERAGE_FAIL_UNDER=80`.
- Adapters (kie.ai, Shotstack, upload-post) must keep targeted unit + contract tests that cover happy path + failure modes.
- Webhooks must keep signature verification + idempotency tests (both FastAPI routes and storage logic).
- Each pipeline (Test Video Gen, AISMR) needs at least one mocked happy-path E2E test; live-provider tests run only when Phase 4 resumes.

### Per-PR testing expectations

For every PR that touches Python code:

- Add or update at least one **unit test** for every new endpoint, orchestrator node, or adapter
- Add or update at least one **integration test** for any new cross-service behavior or pipeline changes
- Performance tests are optional and non-blocking

---

## Need Help?

- **Architecture:** [docs/architecture.md](docs/architecture.md)
- **Testing:** [docs/07-contributing/testing.md](docs/07-contributing/testing.md)
- **Deployment:** [docs/03-how-to/release-cut-and-rollback.md](docs/03-how-to/release-cut-and-rollback.md)
- **Operations:** [docs/05-operations/](docs/05-operations/)

---

## Development Anti-Patterns to Avoid

❌ **Assuming the problem** without observing a real run  
❌ **Treating symptoms** instead of finding root cause  
❌ **Silent fallbacks** that hide real issues  
❌ **Skipping verification** after making changes  
❌ **Undocumented fixes** that will be forgotten  

✅ **Watch it run** and see what actually breaks  
✅ **Trace to root cause** using logs and traces  
✅ **Fail-fast** with clear error messages  
✅ **Verify with real run** after every fix  
✅ **Document with evidence** (run IDs, traces, artifacts)  

---

**Development Cycle: Observe → Diagnose → Fix → Verify → Document**

**Be run-aware. Keep artifacts clean. Document as you go.**
