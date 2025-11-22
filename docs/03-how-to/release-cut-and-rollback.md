# Release Cut and Rollback (Python + Fly.io)

**Audience:** Engineers and operators  
**Outcome:** Safe deployments of the Python API + Orchestrator with a clear rollback path  
**Time:** ~20–30 minutes per release

---

## 1. Pre-release checklist

Run these locally or in CI before you touch production.

```bash
make test             # unit + selected integration tests
make test-coverage    # full suite with coverage gate
ruff check .          # lint
black --check .       # formatting
```

Confirm:
- All tests are green.
- Coverage meets the configured threshold (see `COVERAGE_FAIL_UNDER` in CI).
- `ruff` and `black` report no issues.

If anything fails here, fix it before continuing.

---

## 2. Tag the release

Create an annotated tag from `main` so you can roll back cleanly:

```bash
git checkout main
git pull origin main

git tag -a v0.2.0 -m "Release v0.2.0: Brendan-first API + orchestrator"
git push origin v0.2.0
```

Use whatever version scheme your team has agreed on; the key is that every production deploy maps to a git tag.

---

## 3. Database backups

Before applying migrations in production, ensure you have a recent backup.

For a simple Postgres setup:

```bash
pg_dump "$DATABASE_URL" > backup_pre_v0.2.0_$(date +%Y%m%d%H%M).sql
gzip backup_pre_v0.2.0_*.sql
```

For managed Postgres, prefer the provider’s snapshot/backups feature and record the snapshot ID alongside the release tag.

---

## 4. Apply Alembic migrations

### Local or staging

From the repo root:

```bash
alembic upgrade head
```

Or, if you rely on Docker Compose:

```bash
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

### Production (Fly.io)

From a Fly SSH console or GitHub Actions job:

```bash
fly ssh console -C "alembic upgrade head"
```

Verify migrations:

```bash
psql "$DATABASE_URL" -c "\dt"
```

You should see the expected tables (runs, artifacts, webhook_events, etc.) and the Alembic version row.

---

## 5. Deploy the services (Fly.io)

Ensure Fly is configured (app names, Postgres attachment, secrets).

Two manifests live in the repo root and build Docker images from the same source tree:

- API: `fly.api.toml` → builds via `apps/api/Dockerfile` (`internal_port=8080`, providers auto-switch to live on Fly).
- Orchestrator: `fly.orchestrator.toml` → builds via `apps/orchestrator/Dockerfile` (`internal_port=8090`, providers auto-switch to live on Fly).

`flyctl deploy -c fly.api.toml` / `flyctl deploy -c fly.orchestrator.toml` use the `[build]` sections
to tag images automatically; no separate registry push is needed. Update `app` + `primary_region`
before the first deploy if you use different Fly app names.

### Required secrets

| Secret | Purpose | Applies to |
| --- | --- | --- |
| `API_KEY` | Shared key for `/v1/chat/brendan`, HITL links, orchestrator auth. | API + Orchestrator |
| `DB_URL` | Postgres DSN (same database for runs/artifacts). | API + Orchestrator |
| `REDIS_URL` (optional) | Redis cache for rate limiting. | API |
| `LANGSMITH_API_KEY` | Enable RunTree emission. | API + Orchestrator |
| `SENTRY_DSN` | Error reporting. | API + Orchestrator |
| `KIEAI_API_KEY` | Persona generation provider credentials. | API + Orchestrator |
| `KIEAI_SIGNING_SECRET` | Validate kie.ai webhooks. | API + Orchestrator |
| `SHOTSTACK_API_KEY` | Timeline render provider. | API + Orchestrator |
| `UPLOAD_POST_API_KEY` | TikTok uploader provider. | API + Orchestrator |
| `UPLOAD_POST_SIGNING_SECRET` | Validate upload-post webhooks. | API |
| `HITL_SECRET` | Signs approval links. | API |
| `TELEGRAM_BOT_TOKEN` | Enables the Telegram ingress path. | API |

Base URLs (`public_base_url`, `webhook_base_url`, `orchestrator_base_url`) and `providers_mode`
are derived automatically from the Fly app name. Override them only when debugging locally.

```bash
# Set secrets once per app (repeat for orchestrator if you keep separate secrets)
flyctl secrets set -c fly.api.toml \
  API_KEY=... DB_URL=... SENTRY_DSN=... LANGSMITH_API_KEY=... \
  OPENAI_API_KEY=... TELEGRAM_BOT_TOKEN=... \
  KIEAI_API_KEY=... KIEAI_SIGNING_SECRET=... \
  SHOTSTACK_API_KEY=... \
  UPLOAD_POST_API_KEY=... UPLOAD_POST_SIGNING_SECRET=... \
  HITL_SECRET=...

flyctl secrets set -c fly.orchestrator.toml \
  API_KEY=... DB_URL=... LANGSMITH_API_KEY=... \
  OPENAI_API_KEY=... \
  KIEAI_API_KEY=... KIEAI_SIGNING_SECRET=... \
  SHOTSTACK_API_KEY=... \
  UPLOAD_POST_API_KEY=... UPLOAD_POST_SIGNING_SECRET=...

# Deploy staging API and orchestrator from repo root
flyctl deploy -c fly.api.toml
flyctl deploy -c fly.orchestrator.toml
```

Wait for both apps to be healthy and then run basic checks:

```bash
curl -sS https://<api-host>/health | jq .
curl -sS -H "x-api-key: $API_KEY" https://<api-host>/version | jq .
curl -sS https://<orchestrator-host>/health | jq .
```

You should see `status: "ok"` and the expected version string.

---

## 6. Post-deploy smoke tests

Run a small smoke suite against production to ensure the basics work:

```bash
make smoke API_BASE_URL="https://<api-host>" API_KEY="$API_KEY"
```

Then exercise Brendan directly:

```bash
curl -sS -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"smoke","message":"Make a Test Video Gen run about LangGraph"}' \
  https://<api-host>/v1/chat/brendan
```

Verify:
- Brendan responds with a sensible proposal.
- A `runId` appears in the response or follow-up status calls.
- `/v1/runs/{runId}` returns a `status` of `pending_workflow`, `running`, or `published` as expected.

If any of these basic checks fail, treat the deploy as suspect and consider rolling back.

---

## 7. Rollback procedure

Rollback if:
- `/health` or `/version` fail with 5xx errors.
- Critical endpoints (chat, runs, webhooks, HITL) are failing.
- Smoke tests show regressions you can’t resolve quickly.

### 7.1 Revert code

```bash
git checkout v<previous-tag>
flyctl deploy                  # API
flyctl deploy -a myloware-orchestrator  # Orchestrator
```

### 7.2 Restore database (if migrations broke prod)

If the error is schema/data related and you can’t fix forward:

```bash
gunzip -c backup_pre_v0.2.0_*.sql.gz | psql "$DATABASE_URL"
```

Or use your managed Postgres snapshot restore flow.

After restoring:

```bash
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM runs;"
```

Confirm that key tables exist and row counts make sense.

### 7.3 Verify rollback

```bash
curl -sS https://<api-host>/health | jq .
curl -sS -H "x-api-key: $API_KEY" https://<api-host>/version | jq .
```

The version should match the previous tag, and health checks should be green.

---

## 8. Observability verification (LangSmith + Grafana)

After a successful deploy (or rollback), confirm that observability is still wired:

1. **Prometheus / Grafana**
   - Check Grafana dashboards to ensure API and orchestrator latency/error panels are updating.
2. **LangSmith**
   - Trigger a Brendan chat in the deployed environment.
   - Open LangSmith and confirm:
     - A `brendan-chat` run appears for the conversation.
     - A `<project>-graph` run appears once the workflow is approved and the persona graph starts.

If either channel is missing data, fix observability before shipping further changes.

---

## 9. Post-release notes

After the release (or rollback), update:
- `CHANGELOG.md` with a brief summary of changes.
- Any story/status docs used by the team.

Stick to this flow for each release so you always know:
- Which tag is running in production.
- Which migrations have been applied.
- How to get back to a known-good state quickly.
