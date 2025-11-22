# Live Ops Runbook — Providers, HITL, and Traces

_Date: 2025-11-14 – Owner: Platform/RunOps_

Use this runbook whenever you need to toggle live providers, unblock HITL approvals, or inspect traces for a single run. All commands assume you are in the repo root and have sourced `.venv`.

---

## 1. Turning live providers on/off

### Local / CI (mock mode)
- Keep `USE_MOCK_PROVIDERS=true` (default in `.env.development`).
- No provider secrets are needed; pipelines create artifacts via mocks.
- To confirm you’re in mock mode, hit:
  ```bash
  curl -sS -H "x-api-key: $API_KEY" http://localhost:8080/v1/projects/test_video_gen | jq '.providers'
  ```
  Expect `"mode": "mock"` in the response metadata.

### Staging / Production (live mode)
1. Export real secrets (recommended via `fly secrets` or `.env.production`):
   ```bash
   export API_KEY=...
   export KIEAI_API_KEY=...
   export KIEAI_SIGNING_SECRET=...
   export SHOTSTACK_API_KEY=...
   export UPLOAD_POST_API_KEY=...
   export UPLOAD_POST_SIGNING_SECRET=...
   export HITL_SECRET=...
   export USE_MOCK_PROVIDERS=false
   ```
2. Deploy (`fly deploy` or your CD pipeline) and verify both services are healthy:
   ```bash
   curl -sS http://<api-host>/health
   curl -sS http://<orchestrator-host>/health
   ```
3. Validate provider connectivity with the CLI (each command should succeed and log provider hosts):
   ```bash
   mw-py validate env
   mw-py ingest run --dry-run
   ```
4. Revert to mocks by setting `USE_MOCK_PROVIDERS=true` and restarting the API service. The orchestrator always runs real persona graphs but will publish artifacts based on whatever mode the API configured in the run metadata.

---

## 2. HITL approvals & troubleshooting

### Approval link anatomy
- Workflow gate: `GET /v1/hitl/approve/{runId}/workflow?token=<HMAC>`
- Ideate & prepublish gates: same path with `ideate` or `prepublish`.
- Brendan posts the signed link in chat whenever a gate is reached; links expire after 24h (see `HITL_TOKEN_EXPIRY_HOURS`).

### Common issues
| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| `403 {"detail":"invalid or expired token"}` | Token expired or runId mismatch | Regenerate the link via `/v1/hitl/link/{runId}/{gate}` or ask Brendan in chat to resend. |
| `502 {"detail":"failed to resume run"}` | Orchestrator unreachable during approval | Check orchestrator `/health` and logs. When it comes back, retry the approval; the API now logs the error with `runId`/`gate`. |
| Workflow approval returns 200 but run stays `pending_workflow` | Run didn’t have a `graph_spec` or orchestrator failed silently | Inspect `runs.payload.metadata.workflow_proposal` and orchestrator logs; re-trigger approval after fixing the payload. |

### Manual approval via curl
```bash
curl -sS -H "x-api-key: $API_KEY" \
  "https://api.example.com/v1/hitl/approve/run_abc123/ideate?token=$TOKEN"
```
Check API logs for `myloware.api.hitl` entries to confirm the orchestrator resumed successfully.

---

## 3. Inspecting traces for a single run

### LangSmith (LLM + persona traces)
1. Set `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT` in the environment where the API and orchestrator run.
2. Run `make up` locally or deploy updated secrets remotely.
3. Launch a run (ideally via `/v1/chat/brendan`). After approval, open LangSmith → your project → filter by `run_id:<runId>` to see:
   - `brendan-chat` (conversation graph)
   - `<project>-graph` (persona pipeline)
4. Export spans or share permalinks when filing bugs.

### Grafana/Prometheus (infra metrics)
1. Start Prometheus/Grafana via `make up` (Compose brings both up automatically).
2. In Grafana, open the “MyloWare Orchestration” dashboard and filter by `runId`. The `http_request_duration_seconds` graph shows API + orchestrator latency per persona gate.
3. For ad-hoc debugging, scrape Prometheus directly:
   ```bash
   curl -sS "http://localhost:9090/api/v1/query?query=http_requests_total{runId=\"run_abc123\"}" | jq .
   ```

Use the combination of LangSmith (LLM/persona spans) and Prometheus/Grafana (service metrics) to follow a run from chat to publish.
