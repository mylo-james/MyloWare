# Production Runbook (Python Stack)

**Last Updated:** 2025-11-14  
**Version:** 2.0 (Python/FastAPI + LangGraph)

---

## Overview

Operational checklist for running the Python MyloWare stack in production:
FastAPI API, LangGraph orchestrator, Postgres+pgvector, and provider
integrations (kie.ai, Shotstack, upload-post).

This runbook is intentionally high-level. For detailed procedures, see:

- `docs/03-how-to/release-cut-and-rollback.md` – release, rollback, and Fly deploy.
- `docs/05-operations/backups-and-restore.md` – database backups and recovery.
- `docs/05-operations/observability.md` – LangSmith + Prometheus/Grafana.
- `docs/03-how-to/runbook-live-ops.md` – live providers, HITL approvals, and trace inspection.

---

## 1. Pre-deployment checklist

Run these in CI or locally before touching production.

### 1.1 Tests and coverage

```bash
make test             # unit + selected integration tests
make test-coverage    # full suite, coverage gate, coverage.json
```

Confirm:
- All tests are green.
- Coverage meets or exceeds the configured gate (`COVERAGE_FAIL_UNDER`, currently 80).

### 1.2 Linting and formatting

```bash
ruff check .
black --check .
```

Do not deploy with outstanding lint or formatting errors.

### 1.3 Database migrations

Ensure Alembic migrations are valid and applied in staging:

```bash
alembic upgrade head
```

Or via Docker Compose:

```bash
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

### 1.4 Secrets and environment

Verify secrets in your production environment (Fly or equivalent):

- `API_KEY` – API gateway key (used by clients and MCP adapter).
- `DB_URL` – Postgres connection string.
- `REDIS_URL` – Redis connection string (if applicable).
- `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` – tracing.
- `SENTRY_DSN` – error reporting.
- `KIEAI_API_KEY`, `KIEAI_SIGNING_SECRET` – kie.ai.
- `SHOTSTACK_API_KEY` – Shotstack.
- `UPLOAD_POST_API_KEY`, `UPLOAD_POST_SIGNING_SECRET` – upload-post.
- `HITL_SECRET` – signing key for HITL approval links.
- `/metrics` reachable – `curl -sS https://<api-host>/metrics | head` and the same for the orchestrator; strict startup checks probe the same endpoints.

Run:

```bash
mw-py validate env
```

and fix any reported issues before proceeding.

### 1.5 SLO smoke tests

Run the automated SLO guardrail to make sure Brendan flows, HITL, and metrics are healthy
before shipping:

```bash
API_KEY="$API_KEY" \
scripts/dev/check_slos.py \
  --api-base https://<api-host> \
  --orchestrator-base https://<orchestrator-host>
```

The script triggers one mock Test Video Gen and AISMR run, approves the gates,
scrapes `/metrics`, and enforces the chat/retrieval/publish SLOs. Treat any failures as
release blockers until you understand the regression.

---

## 2. Monitoring & dashboards

Use Grafana as your first stop when validating a deployment or investigating issues:

- **API dashboard**
  - Watch `/v1/chat/brendan`, `/v1/runs/start`, `/v1/webhooks/*`, and `/v1/hitl/approve/*`.
  - Panels: request rate, p95 latency, error rate, and **rate limit hits (429/s)**.
  - p95 latency for chat and run start should stay comfortably below 1–2 seconds.
  - 4xx/5xx rates should be near zero under normal load.
- **Orchestrator dashboard**
  - Track active runs, graph execution time, and HITL wait times by `run_id` and `project`.
  - Use this to see whether graphs are reaching HITL gates and resuming after approval.
- **Provider dashboards**
  - kie.ai, Shotstack, and Upload-Post latency/error panels.
  - Use these to distinguish internal vs provider bottlenecks.
- **Webhook/DLQ dashboard**
  - Monitor inbound webhook volume, signature status, and failure rates.
  - Watch the **Webhook Success/Failure Rate** panel for spikes in 4xx/5xx responses and DLQ depth (once implemented).

See `docs/05-operations/monitoring-dashboards.md` for details on expected panels.

---

## 3. Deploying to Fly.io

Use the release doc for full details; this section gives a condensed view for the
Python API and orchestrator on Fly.io. Staging and production automatically
switch into strict mode based on the Fly app name—no manual `ENVIRONMENT`
variable is required.

### 3.1 Tag and publish release

```bash
git checkout main
git pull origin main
git tag -a v0.3.0 -m "Release v0.3.0: Python API + LangGraph orchestrator"
git push origin v0.3.0
```

### 3.2 Apply migrations in production

From CI or a Fly SSH console:

```bash
fly ssh console -C "alembic upgrade head"
```

Confirm core tables exist:

```bash
psql "$DB_URL" -c "\dt runs artifacts webhook_events"
```

### 3.3 Deploy API and orchestrator

For staging, deploy from the service directories so the checked-in manifests are used:

```bash
cd apps/api
flyctl deploy          # API app (apps/api/fly.toml)

cd ../orchestrator
flyctl deploy          # orchestrator app (apps/orchestrator/fly.toml)
```

Wait for both apps to be healthy, then run:

```bash
curl -sS https://<api-host>/health | jq .
curl -sS -H "x-api-key: $API_KEY" https://<api-host>/version | jq .
curl -sS https://<orchestrator-host>/health | jq .
```

All endpoints must return 200 with sensible payloads before you proceed.

---

## 4. Post-deploy smoke tests

### 4.1 Automated smoke

Run the smoke script against the live environment:

```bash
API_BASE_URL="https://<api-host>" \
ORCH_BASE_URL="https://<orchestrator-host>" \
API_KEY="$API_KEY" \
ITERATIONS=50 \
scripts/smoke.sh
```

Acceptance:
- Error rate for `/health` and `/version` < 5%.

### 4.2 Brendan front-door check

```bash
curl -sS -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"smoke","message":"Make a Test Video Gen run about LangGraph"}' \
  https://<api-host>/v1/chat/brendan | jq .
```

Verify:
- Response includes a `runId`.
- `/v1/runs/{runId}` returns a non-terminal status (`pending_workflow`, `running`, `published`).
- LangSmith shows both `brendan-chat` and `<project>-graph` traces.

If any of these fails, treat the deployment as suspect.

---

## 5. Incident response

### 5.1 Run stuck in non-terminal status

Symptoms:
- Run never leaves `pending_workflow` or `running`.
- No new artifacts or notifications.

Actions:

```sql
SELECT run_id, project, status, created_at, updated_at
FROM runs
ORDER BY created_at DESC
LIMIT 20;
```

- Check orchestrator `/health` and logs.
- Inspect `orchestration_checkpoints` for the stuck `run_id` to see the last known state.
- If a HITL gate is pending, confirm approval request was sent and the link works.

If the state is irrecoverably inconsistent, mark the run failed in the database and notify stakeholders.

### 5.2 Webhook failures

Symptoms:
- Provider webhooks return 4xx/5xx.
- Runs remain in `running` or `publishing` longer than expected.

Actions:

```sql
SELECT provider, signature_status, received_at
FROM webhook_events
ORDER BY received_at DESC
LIMIT 50;
```

- Check for `signature_status != 'valid'`.
- Verify provider signing secrets in env match those configured at the vendor.
- Inspect API logs for `webhook` errors keyed by `run_id`.

### 5.3 HITL approval problems

Symptoms:
- Approving a HITL link returns 4xx/5xx.
- Run stays `pending_workflow` / `awaiting_ideate` / `awaiting_prepublish`.

Actions:
- Check API `/health`.
- Confirm `HITL_SECRET` is set and consistent across deploys.
- Look for `hitl_approvals` entries:

```sql
SELECT run_id, gate, created_at
FROM hitl_approvals
ORDER BY created_at DESC
LIMIT 20;
```

If approvals are recorded but runs do not resume, inspect orchestrator logs for resume failures.

---

## 6. Scaling guidelines

For typical workloads:

- API:
  - Start with 2–3 replicas.
  - Monitor `http_request_duration_seconds` and `http_requests_total` in Prometheus.
- Orchestrator:
  - Start with 2 replicas.
  - Ensure DB and Redis capacity is adequate for concurrent runs.
- Database:
  - Prefer vertical scaling first.
  - Add read replicas only when needed.

Use the architecture doc and Grafana dashboards to tune p95 latencies (tool p95 ≤ 2s, publish p95 ≤ 30s).

---

## 7. Rollback

Rollback steps are detailed in `release-cut-and-rollback.md`. At a high level:

1. Roll back code by deploying the previous git tag.
2. If migrations broke prod and cannot be fixed forward, restore the DB from the most recent backup (see `backups-and-restore.md`).
3. Re-run smoke tests and Brendan front-door checks.

Do not attempt ad-hoc fixes in production without a clear rollback plan.
