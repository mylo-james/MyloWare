# Troubleshooting Guide (Python Stack)

Common issues and fixes for the FastAPI API, LangGraph orchestrator, and
Postgres+pgvector database.

---

## 1. Configuration and startup issues

### 1.1 Error: "configuration validation failed" / service crashes at startup

**Symptoms**
- API or orchestrator exits immediately.
- Logs show missing `API_KEY`, `DB_URL`, or provider secrets.

**Fix**
1. Ensure you have a `.env` file (or equivalent secrets in production).
2. Run:
   ```bash
   mw-py validate env
   ```
   Fix any reported problems (missing keys, invalid URLs, etc.).
3. For production (`environment=prod`), verify:
   - `API_KEY` and provider keys are non-default and at least 12 characters.
   - `HITL_SECRET` is set.

### 1.2 Error: "Cannot connect to database"

**Symptoms**
- API/orchestrator logs show connection failures.
- Health checks return 5xx.

**Fix**
1. Confirm Postgres is running and reachable:
   ```bash
   psql "$DB_URL" -c "SELECT 1"
   ```
2. Check `DB_URL` matches your environment (host, port, database).
3. In Docker Compose, confirm the `postgres` service is healthy:
   ```bash
   docker compose -f infra/docker-compose.yml ps
   ```
4. Restart the stack:
   ```bash
   make down
   make up
   ```

---

## 2. Database and migrations

### 2.1 Error: "relation does not exist"

**Symptoms**
- API or orchestrator fails when accessing `runs`, `artifacts`, or `webhook_events`.

**Fix**
Apply Alembic migrations:

```bash
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

Or, from a shell with DB access:

```bash
alembic upgrade head
```

### 2.2 Error: "extension vector does not exist"

**Symptoms**
- KB features fail.
- pgvector operations error out.

**Fix**

```bash
psql "$DB_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql "$DB_URL" -c "\dx vector"
```

---

## 3. API and orchestrator issues

### 3.1 Health checks failing

**Symptoms**
- `/health` returns 5xx or times out.

**Fix**
1. Check logs:
   ```bash
   docker compose -f infra/docker-compose.yml logs -f api orchestrator
   ```
2. Ensure all dependent services (Postgres, Redis) are healthy:
   ```bash
   docker compose -f infra/docker-compose.yml ps
   ```
3. Verify configuration using `mw-py validate env`.

### 3.2 `/v1/chat/brendan` returns 4xx/5xx

**Symptoms**
- Front-door chat endpoint fails.

**Fix**
1. Confirm the `x-api-key` header matches `API_KEY`.
2. Check that `DB_URL` points to a live database and migrations are applied.
3. Inspect API logs for stack traces and context.

---

## 4. Run lifecycle and HITL

### 4.1 Run stuck in `pending_workflow` or `running`

**Symptoms**
- `/v1/runs/{runId}` never reaches `published` or `failed`.

**Fix**
1. Inspect the run:
   ```sql
   SELECT run_id, project, status, created_at, updated_at
   FROM runs
   WHERE run_id = '<runId>';
   ```
2. If `status = 'pending_workflow'`, verify that a workflow HITL link was generated and approved.
3. If `status = 'running'`, check orchestrator `/health` and logs for errors resuming the run.
4. Inspect recent artifacts for that run:
   ```sql
   SELECT type, provider, url, metadata, created_at
   FROM artifacts
   WHERE run_id = '<runId>'
   ORDER BY created_at ASC;
   ```

### 4.2 HITL approval errors

**Symptoms**
- Approving a HITL link returns 403/500.

**Fix**
1. Confirm `HITL_SECRET` is set and matches the environment that generated the link.
2. Check API logs for `hitl`-related entries and errors.
3. Verify the run appears in `hitl_approvals`:
   ```sql
   SELECT run_id, gate, created_at
   FROM hitl_approvals
   ORDER BY created_at DESC
   LIMIT 20;
   ```

---

## 5. Provider and webhook issues

### 5.1 Webhooks rejected with "invalid signature"

**Symptoms**
- Provider retries callbacks.
- `webhook_events.signature_status` shows `invalid`.

**Fix**
1. Check that signing secrets match vendor configuration:
   - `KIEAI_SIGNING_SECRET`
   - `UPLOAD_POST_SIGNING_SECRET`
2. Inspect recent webhook events:
   ```sql
   SELECT provider, signature_status, received_at
   FROM webhook_events
   ORDER BY received_at DESC
   LIMIT 50;
   ```
3. Correct secrets and redeploy. New events should show `signature_status = 'valid'`.

### 5.2 Slow or failing providers

**Symptoms**
- Long run times or failures during video generation, editing, or publish.

**Fix**
1. Check API logs around the affected `runId`.
2. Inspect Prometheus metrics (`kieai_job_seconds`, `shotstack_render_seconds`, `upload_post_seconds`) in Grafana.
3. If using live providers, temporarily flip back to mocks by setting:
   ```bash
   USE_MOCK_PROVIDERS=true
   ```
   and restarting the API, then re-run the pipeline to confirm local logic is sound.

---

## 6. Observability

### 6.1 No traces in LangSmith

**Symptoms**
- Runs complete, but LangSmith shows no `brendan-chat` or `<project>-graph` runs.

**Fix**
1. Ensure `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT` are set.
2. Confirm the environment variables are visible to both API and orchestrator containers.
3. Trigger a small run via `/v1/chat/brendan` and check LangSmith again.

### 6.2 No metrics in Grafana

**Symptoms**
- Grafana panels are empty or stale.

**Fix**
1. Confirm the Prometheus container is running:
   ```bash
   docker compose -f infra/docker-compose.yml ps
   ```
2. Open Prometheus UI and verify `http_request_duration_seconds` has recent samples.

---

## 7. When to escalate

Escalate to the platform/ops owner when:

- Multiple runs are stuck or failing unexpectedly.
- Provider outage extends beyond documented SLAs.
- You need to restore from backup or roll back a release.

Include:
- `runId` examples.
- Relevant log snippets.
- Any SQL queries or metrics screenshots used during diagnosis.
