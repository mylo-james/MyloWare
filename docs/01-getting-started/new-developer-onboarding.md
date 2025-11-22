# New Developer Onboarding — MyloWare OSS-first Stack

**Audience:** New engineers (or agents) ramping onto MyloWare.  
**Goal:** Go from zero → local demo → first PR in ≤ 1–2 days.

This guide assumes you have basic Python, Docker, and git experience. It is the
canonical onboarding path.

---

## 0. Prerequisites

- macOS or Linux workstation
- Docker + Docker Compose
- Python **3.11** (match the version used in CI)
- `make` (for the convenience targets)
- A personal API key value for local dev (any non-empty string)

Optional but recommended:

- An IDE with Python + pytest integration
- `httpie` or `curl` + `jq` for API calls

---

## 1. Clone, create a virtualenv, install deps

```bash
git clone https://github.com/yourusername/myloware.git
cd myloware

python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env
export API_KEY="dev-api-key"  # used by local curl/mw-py calls
```

If you use a shell profile (`.zshrc`, `.bashrc`), consider adding a short
helper:

```bash
alias mw-venv='source .venv/bin/activate'
```

---

## 2. Boot the local stack and apply migrations

From the repo root:

```bash
# Start Postgres, Redis, API, Orchestrator, Prometheus, Grafana
make up

# Apply Alembic migrations inside the API container
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

Health checks:

```bash
curl -sS http://localhost:8080/health | jq .
curl -sS http://localhost:8090/health | jq .
```

You should see `status: "ok"` responses from both services.

To tail logs during development:

```bash
make logs
```

Stop the stack when you are done:

```bash
make down
```

## 3. Run tests and understand coverage

Unit + integration tests (Python API + orchestrator):

```bash
make test
```

Coverage (when the `coverage` package and Python 3.11 toolchain are available):

```bash
make test-coverage
```

This generates:

- `coverage.json` – used by coverage tooling in the repo
- `python-coverage.xml` – CI/IDE integration

The target in `Makefile` enforces `COVERAGE_FAIL_UNDER=80` when coverage tools
are available. CI uses the same threshold.

---

## 4. Talk to Brendan (front door)

All user and tool interactions go through Brendan:

```bash
curl -sS -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"demo","message":"What is the Test Video Gen pipeline?"}' \
  http://localhost:8080/v1/chat/brendan | jq .
```

You should see:

- A natural language answer
- A `run_ids` array when Brendan decides to start a run
- A `citations` array referencing docs used to answer the question

Internally, Brendan uses tools (e.g. `build_and_start_graph`) to construct
per-project LangGraph graphs and start runs in the orchestrator.

---

## 5. Run demos (mock and live)

### 5.1 Mock pipelines via CLI

With the stack up and `USE_MOCK_PROVIDERS=true` in `.env`:

```bash
mw-venv        # if you created the alias
mw-py demo test-video-gen
mw-py demo aismr
mw-py demo test-video-gen
```

Each command:

- Calls `/v1/chat/brendan` to start a run
- Polls `/v1/runs/{runId}` until completion
- Prints a summary (status, publish URLs, artifact preview)

### 5.2 Live Test Video Gen slice (staging)

Live providers (kie.ai, Shotstack, upload-post) are only enabled in **staging**
and **prod**. The high-level flow:

1. Populate `.env.staging` (or the equivalent secret store) with:
   - `DB_URL` for the staging Postgres instance
   - Provider credentials (`KIEAI_*`, `SHOTSTACK_*`, `UPLOAD_POST_*`)
   - `HITL_SECRET`, `LANGSMITH_API_KEY`, `SENTRY_DSN`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`
2. Run `infra/scripts/bootstrap_staging_secrets.sh` to sync secrets into Fly.
3. Deploy API + orchestrator using `make deploy-staging-api` / `make deploy-staging-orchestrator`.
4. Start a run via Brendan against the staging API and approve HITL gates.

Detailed staging notes live in `implementation-plan.md` (Step 21) and
`docs/05-operations/production-runbook.md`.

---

## 6. First contribution: small change + test

To keep quality high, **every Python change** should ship with at least one new
or updated test.

Suggested first tasks:

1. Pick a small area close to your interests:
   - API routes (`apps/api/routes/**`)
   - Video pipeline service (`apps/api/services/test_video_gen/**`)
   - Adapters (providers, persistence, security)
   - CLI (`cli/main.py`)
2. Make a focused change:
   - Tighten validation
   - Improve logging (e.g. include `run_id`/`project` in a log line)
   - Add a tiny convenience CLI flag
3. Add/extend tests:
   - Unit tests under `tests/unit/python_api/**`, `tests/unit/adapters/**`, or `tests/unit/cli/**`.
   - Integration tests under `tests/integration/python_api/**` if your change spans the API boundary.
4. Run `make test` locally and ensure everything passes.

Use `implementation-plan.md` and `docs/architecture.md` as your north stars for
what “done” looks like; new behaviour should line up with the gates described
there.

---

## 7. Where to look next

- `implementation-plan.md` – the live execution plan (gates A–F, steps 0–26).
- `docs/architecture.md` – deeper architecture and data-model details.
- `docs/05-operations/production-runbook.md` – how to debug runs, webhooks, and DLQ entries.
- `tests/unit/python_api/test_test_video_gen_pipeline.py` – mocked E2E pipeline example.

When in doubt, favor Brendan-first flows, per-project graphs, and HITL gates as
described in the North Star document. This ensures new work composes cleanly
with the existing orchestration model.
