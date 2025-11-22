# Demo Script (Brendan-first)

Use this runbook when giving a live demo or validating the repo before sharing it.

## 1. Boot the stack
```bash
make up
source .venv/bin/activate
pip install -e '.[dev]'
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

## 2. Ingest knowledge base
```bash
mw-py kb ingest --dir data/kb/ingested
```
Expect `KB ingest complete` with document/embedding counts.

## 3. Ask Brendan a question
```bash
curl -sS -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"user_id":"demo","message":"What is AISMR?"}' \
  http://localhost:8080/v1/chat/brendan | jq .
```
Check that the response includes:
- `citations` array referencing KB docs
- A `retrieval.trace` artifact in the DB (`artifacts` table)

## 4. Start a production run via CLI (Brendan-first)
```bash
mw-py demo aismr
```
The command will:
1. POST `/v1/chat/brendan` with a canned AISMR request
2. Wait for Brendan to start a production run and surface the `runId`
3. Poll `/v1/runs/{runId}` until completion
4. Print a summary containing persona artifacts and publish URLs

## 5. (Optional) Exercise HITL via Brendan
If you prefer a conversational flow:
1. `curl /v1/chat/brendan` with "Make an AISMR video about candles"
2. Approve workflow gate: `curl /v1/hitl/approve/<runId>/workflow`
3. Approve `ideate` and `prepublish` gates as Brendan notifies you (either via chat tools or `curl`)

## 6. Validate publish artifacts
Fetch run details:
```bash
curl -sS -H "x-api-key: $API_KEY" http://localhost:8080/v1/runs/<runId> | jq .
```
Ensure:
- `status` is `published`
- `artifacts` include `ideation`, `scripts`, `renders`, `publish.url`
- `result.publishUrls` contains the canonical link (mock URL in local mode)

## 7. Optional live-provider smoke / endpoint proof

When you want to prove that the live endpoints work (and, with real provider secrets, actually publish a test video), use the new live-run helper:

```bash
export API_KEY=...                # staging/prod API key
export API_BASE_URL=https://studio.<env>.domain
export USE_MOCK_PROVIDERS=false   # only if you want live providers

mw-py live-run test-video-gen
```

What this command does:
1. Calls `/v1/chat/brendan` to request a Test Video Gen run (the same public entrypoint users hit).
2. Polls `/v1/runs/{runId}` and automatically approves every HITL gate (`workflow`, `ideate`, `prepublish`) by calling `/v1/hitl/link/*` and `/v1/hitl/approve/*`.
3. Waits for the run to reach `status="published"` and prints the publish URLs.

If you leave `USE_MOCK_PROVIDERS=true` (the default in local/staging), the run completes with mock URLs, which is still enough to prove the API + orchestrator path works end-to-end. Flip the flag (and set `KIEAI_*`, `SHOTSTACK_*`, `UPLOAD_POST_*` secrets) to drive the real providers and confirm a test video actually posts in staging.

## 8. Tear down
```bash
make down
```

Document the run ID(s) and LangSmith trace URLs when sharing the repo so reviewers can replay the demo.
