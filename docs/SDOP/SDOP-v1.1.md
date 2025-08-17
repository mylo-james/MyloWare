## MyloWare — System Design & Operations Plan (SDOP) v1.1 (MVP + Slack)

### 0) Changelog

- **v1.1**: Slack-first interface added (single bot → Orchestrator), human-in-the-loop (HITL) approvals wired via Slack (mocked by policy for MVP).
- **v1.0**: Hybrid, verifiable MVP; OpenAI Agents SDK for all agents; namespaced memory with importance+decay.

---

### 1) Goals & Non-Goals

**Goals**
- **Deterministic workflow execution**: leases, retries, idempotency.
- **OpenAI Agents SDK** for all agents (CPU steps as tool-only agents; LLM steps only where outputs are strictly verifiable).
- **Slack is the front door**: talk to the Orchestrator in `#mylo-control`; approvals in `#mylo-approvals`; summaries in `#mylo-feed`.
- **Strict namespace fences**; capability tokens; importance-scored memory with decay + hot/warm/cold tiers.
- **Operator-ready**: SLOs, runbooks, cost budgets, audit logs.

**Non-Goals (MVP)**
- Multi-org tenancy (use `team_id` only).
- Cross-team federation/auditor agent.
- Fancy UI beyond a minimal Run Trace page.

---

### 2) Primary User Journeys

1. Kick off a run from Slack: `/mylo new "Health: Extract & Verify"` → orchestrator starts DAG → updates in `#mylo-feed` (threaded by run).
2. HITL gate: dead-letter or policy gate posts an approval card in `#mylo-approvals`; for MVP, Orchestrator auto-acts (mock human) but wiring is real.
3. Ask status: `/mylo status r-123` → compact trace + “View Trace” button.
4. Chat with Orchestrator: `/mylo talk` opens a thread; Orchestrator answers and can spawn work orders.

---

### 3) Architecture (High Level)

```
Slack App (single bot)
   │  /commands + actions (Block Kit)
   ▼
Notify MCP (Slack adapter)  ───────────────┐
   │                                      │
   ▼                                      │
Orchestrator (Temporal workflow)  ◀─events│
   │  orders                              │
   ▼                                      │
Board MCP  ── outbox → Bus → Agents  → results → Integrator → Memory MCP
                                    (OpenAI Agents SDK)

Control plane: Orchestrator (Temporal), Board Librarian (Dispenser), Completed Work Librarian (Integrator).
Data plane: Postgres (truth), Memory MCP (pgvector+KV, importance/tiering), optional object store.
Event plane: Redis Streams (MVP) → plan NATS/Kafka.
Compute: Agent workers (OpenAI Agents SDK, autoscale later).
```

---

### 4) Tech Stack Decisions (ADRs)

- **ADR-001 Orchestration**: Temporal for retries, timers, heartbeats, idempotency.
- **ADR-002 DB**: Postgres (PITR on; partition work tables monthly).
- **ADR-003 Bus**: Redis Streams now; partitioned NATS/Kafka later.
- **ADR-004 Agents**: OpenAI Agents SDK everywhere. CPU steps = tool-only with `tool_choice`; LLM steps = JSON schema mode, `temperature=0`.
- **ADR-005 Memory**: pgvector + KV with importance/decay and hot→warm→cold tiering.
- **ADR-006 Auth**: JWT capability tokens (≤15 min TTL) with claims `{team_id, run_id, task_id, persona_id, aud[], scopes[], exp}`.
- **ADR-007 Contracts**: JSON Schema (versioned); Integrator enforces.

---

### 5) Data Model (Core Tables)

- **work_order**: `order_id, task_id, step_id, goal, input_json, namespaces[], cap_token, output_schema_id, timeout_sec, cost_budget_tokens, attempt, lease_id, lease_ttl`
- **work_item**: `id, task_id, assigned_persona_id, status, depends_on[], vars_json, priority, created_at, updated_at`
- **attempt**: `attempt_id, order_id, started_at, ended_at, outcome, error, op_id`
- **event_outbox / event_inbox**: reliable pub/sub bridge
- **runs**: `run_id, team_id, slack_channel_id, slack_thread_ts`
- **mem_doc**: `id, team_id, namespace, text, tags[], class(kb|episodic|log), embedding, quality_score, created_at`
- **mem_actor_importance**: `doc_id, actor_key(role:fe-dev…), raw_score, last_update_at, last_used_at, use_7d, use_30d`
- **mem_use_event**: `doc_id, actor_key, run_id, ts, weight`

---

### 6) Namespaces & TTLs

- `team/<team_id>/org/*` (shared SOPs; no TTL; often pinned)
- `team/<team_id>/task/<task_id>/*` (episodic; TTL 7 days, nightly compaction)
- `team/<team_id>/persona/<persona_id>/*` (long-lived; no TTL)

**Importance & decay (defaults)**
- Half-life: 30d episodic, 90d kb, ∞ when `pinned=true`.
- Boost on validated use: +8 (role level), capped at 1000.
- Tiering: hot (indexed) → warm (<10 importance & 90d idle) → cold (warm 180d). Optional delete: cold episodic >365d & not pinned.

---

### 7) Slack Integration (MVP)

**App & Channels**
- One Slack app / one bot.
- Channels: `#mylo-control` (commands/chat), `#mylo-approvals` (gates), `#mylo-feed` (summaries).
- All run updates posted as threads in `#mylo-feed` keyed by `run_id`.
- DM support for private chat with Orchestrator.

**Commands (slash)**
- `/mylo new "<goal>" [template=invoice|ticket|status] [noise=low|med|high]`
- `/mylo status [run_id|task_id]`
- `/mylo talk` (opens a thread to chat with Orchestrator)
- `/mylo stop [run_id]`, `/mylo mute [run_id]`

**Approvals (actions)**
- Approval cards in `#mylo-approvals` with buttons Retry once / Skip / Abort.
- MVP: Orchestrator auto-acts (mock human) but the same path supports real clicks.

**Webhooks & Mapping**
- `POST /slack/commands` → verify signature → Board MCP calls (create task/order, status).
- `POST /slack/actions` → verify signature → `notify.action` → Orchestrator decision APIs.
- Store `{slack_channel_id, thread_ts}` per `run_id` to update in place.

**Message Anatomy (Block Kit)**
- Header: `Run r-8d2 • Health: Extract & Verify`
- Fields: `ExtractorLLM — PASS (4.8s • 153 tokens)`; `used_mem_ids: team/alpha/org/sop/extract.v1`
- Buttons: View Trace, Open Artifacts
- All messages include `team_id, run_id, order_id` (IDs visible + in metadata).

**Approval Card Example**

```json
{
  "blocks": [
    {"type":"header","text":{"type":"plain_text","text":"Gate: Retry ExtractorLLM?"}},
    {"type":"section","fields":[
      {"type":"mrkdwn","text":"*Run:* r-8d2"},
      {"type":"mrkdwn","text":"*Reason:* schema_invalid (code pattern)"}
    ]},
    {"type":"actions","elements":[
      {"type":"button","text":{"type":"plain_text","text":"Retry once"},
       "style":"primary","action_id":"approve_retry","value":"r-8d2|op-123"},
      {"type":"button","text":{"type":"plain_text","text":"Skip"},
       "action_id":"approve_skip","value":"r-8d2|op-124"},
      {"type":"button","text":{"type":"plain_text","text":"Abort"},
       "style":"danger","action_id":"approve_abort","value":"r-8d2|op-125"}
    ]}
  ]
}
```

---

### 8) Agents & Workflows (MVP)

**Agents (OpenAI Agents SDK)**
- **RecordGen** (CPU/tool-only) → synthetic doc + ground truth.
- **ExtractorLLM** (LLM) → extract fields to strict JSON schema; cite `used_mem_ids`.
- **SchemaGuard** (CPU/tool-only) → compare to ground truth; classify fail reason.
- **Persister** (CPU/tool-only) → write summaries to memory.
- **Verifier** (CPU/tool-only) → consistency/hash check.
- **(Optional) SummarizerLLM** → 1–2 sentence recap with citations (feature-flag off by default).

**Health DAG**

`recordgen → extractorLLM → schemaguard → persister → verifier → (optional summarizerLLM)`

**Branches**
- `schema_invalid` → one stricter re-prompt → else dead-letter.
- `wrong_value` → no retry (shows real accuracy) → dead-letter.

**LLM Prompts/Decoding**
- System: “Output valid JSON per schema; cite `used_mem_ids` only from provided retrieval; refusal JSON on missing info.”
- `temperature=0`, `top_p=1`, output capped (≤ 200 tokens), input budget (≤ 800 tokens).
- Budget breach → refusal; orchestrator can retry with trimmed context once.

---

### 9) Contracts (Schemas)

**ExtractorLLM Output (v1)**

```json
{
  "type":"object",
  "properties":{
    "extracted_fields":{
      "type":"object","properties":{
        "title":{"type":"string"},
        "code":{"type":"string","pattern":"^[A-Z]{3}-\\d{4}$"},
        "amount":{"type":"number"},
        "date":{"type":"string","format":"date"}
      },
      "additionalProperties": false
    },
    "used_mem_ids":{"type":"array","items":{"type":"string"}}
  },
  "required":["extracted_fields","used_mem_ids"],
  "additionalProperties": false
}
```

**Pass/Fail Rules**
- Schema valid AND every ground-truth field matches exactly (date normalized ISO; amount tolerance ±0.01).
- Missing in truth → must be omitted (no hallucinations).
- Otherwise fail with reason: `missing_field | wrong_type | wrong_value | extra_field | pattern_mismatch`.

---

### 10) Reliability Rails

- **Leases & heartbeats**: `lease_ttl=30s`, heartbeat every 10s; orchestrator rescues expired leases.
- **Outbox→Bus with consumer inbox**; `orders.complete(op_id)` idempotent.
- **Retry taxonomy**

| Failure class       | Agent return | Orchestrator policy                         |
|---------------------|--------------|---------------------------------------------|
| rate_limit/transient| error        | backoff 1s/4s/10s, max 3                    |
| timeout             | error        | 2 retries                                   |
| schema_invalid (LLM)| decline      | 1 stricter re-prompt, else DL               |
| wrong_value (LLM)   | decline      | no retry, DL                                |
| capability_missing  | decline      | replan                                      |
| tool_error (CPU)    | error        | retry 2×, else DL                           |

- **Persona mutex**: prevent double checkout.

---

### 11) Observability & SLOs

- Correlation on every log/metric: `{team_id, run_id, task_id, order_id, step_id, persona_id}`.
- Dashboards: Run Trace, Board Status, Persona Health, Token Spend.
- SLOs (MVP): p95 CPU step ≤ 2s; p95 LLM step ≤ 6s; step success ≥ 98%; dead-letters < 1%; token/run ≤ budget.

---

### 12) Cost & Budgets

- Only ExtractorLLM required in MVP.
- Budgets: input ≤ 800 tokens, output ≤ 200; exceed → refusal.
- Cost dashboard: tokens per step/run/persona; alert on breach.

---

### 13) Testing & Evals

- Golden set: 12 docs (4× invoice, 4× ticket, 4× status) → 100% pass in CI.
- Jailbreak set: prompt-like phrases in doc body → still strict JSON.
- Load: N parallel runs; no lease expirations; meet SLOs.
- Chaos: kill Extractor mid-lease; ensure rescue + idempotent completion.
- Slack tests: `/mylo new`, status, approvals (mocked + manual), idempotent action retries.

---

### 14) Runbooks (Abbrev.)

- **RB-01 Agent stuck** → no heartbeat → rescue lease → re-issue → notify.
- **RB-02 Dead-letters spike** → check schema drift, reduce issuance, rollback Extractor prompt.
- **RB-03 Bus backlog** → throttle issuance; scale workers; check outbox relay.
- **RB-04 Token storms** → clamp budgets; cheaper model; trim retrieval context.
- **RB-05 Slack noise** → coalesce updates; post summaries only; use ephemeral for FYIs.

---

### 15) Risks & Mitigations

- **JSON drift** → JSON mode + schema; one self-revise; optional “restyler” (no new facts); refusal path.
- **Retrieval junk** → importance scoring + TTL + compaction + diversity filter.
- **Persona saturation** → concurrency caps; autoscale (KEDA later); fair scheduling.
- **Cost overruns** → budgets, per-persona ceilings, refusal fallback.
- **Slack duplication** → idempotent `op_id` handling; verify signatures.

---

### 16) Rollout Plan

**Week 1 (MVP)**
- Deploy Postgres, Redis, Temporal.
- Build MCPs: board, memory, notify (Slack adapter).
- Implement agents (RecordGen, ExtractorLLM, SchemaGuard, Persister, Verifier).
- Namespaces, capability tokens, leases, retries, idempotent completes.
- Slack app: `/mylo new|status|talk`, approval card; mocked HITL policy.
- Run Trace UI; golden tests pass.

**Weeks 2–3 (Harden)**
- Outbox/inbox everywhere; dead-letter actions; token dashboard.
- Importance sweep/tiering; TTL compaction for `team/<team_id>/task/*`.
- Policy service for scopes/approvals; fairness & concurrency limits.

**Quarter (Scale)**
- Bus → NATS/Kafka (partition by `task_id`).
- MCP Gateway (auth/rate-limit/audit).
- Vector tiers + re-embed jobs; reward-weighted retrieval.
- Autoscaling workers (KEDA); regional shards as needed.

---

### 17) Open Questions (to Finalize)

1. Extractor model tier (e.g., gpt-4o-mini vs higher) and hard budgets.
2. JSON restyler included Day‑1 or added only if drift observed?
3. Schema registry location (repo folder vs lightweight service).
4. Golden templates exact mix & noise profiles.
5. Slack deploy mode (Socket Mode vs HTTPS) and which channels to start with.
6. Which actions require real human approval (beyond mocked policy)?


