## MyloWare — System Design & Operations Plan (SDOP) v1.2 (MVP + Slack + HITL Deep Spec)

### 0) Human-in-the-Loop (HITL) Decision Board

Use this section to record the human decisions that tune policy, risk posture, and operational behavior. Items marked [MVP] must be decided before production MVP launch. Leave answers inline. The Orchestrator reads these via the Policy MCP.

**How to use**

- Answer each decision as indicated. If you defer, assign a target date.
- For matrix items, pick one of: Auto (no human), Soft Gate (can auto after timeout), Hard Gate (blocks until human).
- When a decision is changed, add a dated entry in the Change Log below and update the effective date here.

**Immediate decisions for MVP go/no-go**

- None (applied below)

**Approval Policy Matrix (proposed defaults)**

- **LLM wrong value (accuracy failure)**: Hard Gate (dead-letter + review) → Decision: ____
- **Budget increase (token or cost) within +20% of run cap**: Soft Gate (auto after 1 min) → Decision: ____
- **Budget increase beyond +20% of run cap**: Hard Gate → Decision: ____
- **Production deploy of policy/prompt**: Hard Gate → Decision: ____
- **Rewrite of JSON Schemas**: Hard Gate (requires re-confirmation step by Mylo) → Decision: ____
- **Dead-letter re-issue (single attempt)**: Soft Gate (auto after 5 min) → Decision: ____
- **Privacy risk (PII detected)**: Hard Gate → Decision: ____
- **Slack channel creation/permissions changes**: Hard Gate → Decision: ____

**Escalation and SLAs (defaults, propose)**

- Acknowledge within: 5 minutes business hours, 30 minutes off-hours → Decision: ____
- Resolve within: 60 minutes Sev‑2, next business day Sev‑3 → Decision: ____
- Timeout for Soft Gate auto-approval: 2 minutes → Decision: ____

**Approver roster**

- Approver: Mylo

**Auditability**

- Record approval events to `approval_event` table; retain 365 days. → Decision: ____
- Require justification note on Hard Gate approvals. → Decision: ____

#### Quick explainers

##### Token budgets explained

- What: Hard caps for tokens per run (input and output). Prevents cost/runaway prompts.
- Why: Keeps LLM costs predictable; enforces refusal instead of overspending.
- Policy (MVP): input ≤ 800, output ≤ 200; refusal on breach.

##### Golden set explained

- What: Fixed set of labeled documents used in CI to verify extraction accuracy.
- Why: Guarantees regressions are caught; enables measurable quality gates.
- Policy (MVP): 12 docs (4× invoice, 4× ticket, 4× status) across low/med/high noise.

##### Data residency explained

- What: Whether PII or sensitive data may be processed/stored and in which region.
- Why: Compliance (e.g., GDPR/CCPA) and customer commitments.
- Policy (MVP): PII allowed: no; store only synthetic/test data until policies are in place.

---

### 1) Changelog

- **v1.2**: Added top-of-doc HITL Decision Board; expanded ADRs, data model, observability, security/compliance, and runbooks. Formalized approval policy matrix and audit model. Clarified Slack scopes, rate limits, and failure handling. Added schema contracts for policy/approvals. Implemented decisions: Extractor model `gpt-4o-mini`, JsonRestyler enabled, Slack Socket Mode, schema_invalid soft gate (2 min), token budgets (800/200), golden set (12 docs), PII not allowed for MVP.
- **v1.1**: Slack-first interface added (single bot → Orchestrator), human-in-the-loop (HITL) approvals wired via Slack (mocked by policy for MVP).
- **v1.0**: Hybrid, verifiable MVP; OpenAI Agents SDK for all agents; namespaced memory with importance+decay.

---

### 2) Goals & Non-Goals

**Goals**

- **Deterministic workflow execution**: leases, retries, idempotency.
- **OpenAI Agents SDK** for all agents (CPU steps as tool-only agents; LLM steps only where outputs are strictly verifiable).
- **Slack is the front door**: talk to the Orchestrator in `#mylo-control`; approvals in `#mylo-approvals`; summaries in `#mylo-feed`.
- **Strict namespace fences**; capability tokens; importance-scored memory with decay + hot/warm/cold tiers.
- **Operator-ready**: SLOs, runbooks, cost budgets, audit logs, and explicit HITL policy.
- **Security by default**: least privilege, short-lived tokens, signed webhooks, encryption at rest/in transit.

**Non-Goals (MVP)**

- Multi-org tenancy (use `team_id` only).
- Cross-team federation/auditor agent.
- Fancy UI beyond a minimal Run Trace page.
- Automatic model selection (manual for MVP).

---

### 3) Primary User Journeys

1. Start a run from Slack: `/mylo new "Health: Extract & Verify"` → Orchestrator starts DAG → updates in `#mylo-feed` (threaded by run).
   - Acceptance: thread is created or reused; message includes `run_id`, buttons, latency, token use.
2. HITL gate: policy or error posts an approval card in `#mylo-approvals`.
   - Acceptance: clicking buttons records an `approval_event` and unblocks policy path; soft gates auto-approve after timeout.
3. Ask status: `/mylo status r-123` → compact trace + “View Trace”.
   - Acceptance: returns last 10 steps with outcomes and links.
4. Chat with Orchestrator: `/mylo talk` opens a thread; Orchestrator answers and can spawn work orders.
   - Acceptance: Orchestrator reply references `run_id` and any spawned `task_id`.
5. Review dead-letters: in `#mylo-feed` summary, follow “Open Artifacts” → shows failure artifacts and next actions.

---

### 4) Architecture (High Level)

```text
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

Control plane: Orchestrator (Temporal), Policy Service (HITL rules), Board Librarian (Dispenser), Completed Work Librarian (Integrator).
Data plane: Postgres (truth), Memory MCP (pgvector+KV, importance/tiering), optional object store (artifacts).
Event plane: Redis Streams (MVP) → plan NATS/Kafka.
Secrets: environment vault or KMS-managed secrets.
Compute: Agent workers (OpenAI Agents SDK, autoscale later).
```

Interfaces

- Slack adapter: Socket Mode (MVP) for commands/actions; optional HTTPS events retained for future ingress.
- Policy service: synchronous decision API returning `allow | soft_gate(timeout_ms) | deny(reason)` plus UI metadata.
- Outbox/inbox: at-least-once delivery with idempotent consumers.

---

### 5) Tech Stack Decisions (ADRs)

- **ADR-001 Orchestration**: Temporal for retries, timers, heartbeats, idempotency.
- **ADR-002 DB**: Postgres (PITR on; partition work tables monthly).
- **ADR-003 Bus**: Redis Streams now; partitioned NATS/Kafka later.
- **ADR-004 Agents**: OpenAI Agents SDK everywhere. CPU steps = tool-only with `tool_choice`; LLM steps = JSON schema mode, `temperature=0`. ExtractorLLM model: `gpt-4o-mini` (MVP).
- **ADR-005 Memory**: pgvector + KV with importance/decay and hot→warm→cold tiering.
- **ADR-006 Auth**: JWT capability tokens (≤15 min TTL) with claims `{team_id, run_id, task_id, persona_id, aud[], scopes[], exp}`.
- **ADR-007 Contracts**: JSON Schema (versioned); Integrator enforces.
- **ADR-008 Slack Mode**: Socket Mode for MVP (no public ingress required). HTTPS events can be enabled later.
- **ADR-009 Schema Registry**: Store in repo `contracts/` with semantic versioning; Integrator checks compatibility on upgrade.
- **ADR-010 Policy Service**: Declarative rules (YAML/JSON) + runtime evaluation; approvals stored in `approval_event`.
- **ADR-011 Observability**: Structured logs (JSON), OpenTelemetry traces/metrics, correlation IDs propagated end-to-end.
- **ADR-012 Secrets**: Rotate Slack signing secret and bot token quarterly; no secrets in logs.

---

### 6) Data Model (Core Tables)

- **work_order**: `order_id, task_id, step_id, goal, input_json, namespaces[], cap_token, output_schema_id, timeout_sec, cost_budget_tokens, attempt, lease_id, lease_ttl`
- **work_item**: `id, task_id, assigned_persona_id, status, depends_on[], vars_json, priority, created_at, updated_at`
- **attempt**: `attempt_id, order_id, started_at, ended_at, outcome, error, op_id`
- **event_outbox / event_inbox**: reliable pub/sub bridge
- **runs**: `run_id, team_id, slack_channel_id, slack_thread_ts`
- **mem_doc**: `id, team_id, namespace, text, tags[], class(kb|episodic|log), embedding, quality_score, created_at`
- **mem_actor_importance**: `doc_id, actor_key(role:fe-dev…), raw_score, last_update_at, last_used_at, use_7d, use_30d`
- **mem_use_event**: `doc_id, actor_key, run_id, ts, weight`
- **approval_event** (new): `id, run_id, op_id, approver, policy_key, decision(allow|auto_allow|deny|abort|skip|retry), reason, note, created_at`
- **dead_letter** (new): `id, run_id, op_id, reason_code, payload, created_at, resolved_at, resolver`
- **policy_rule** (new): `policy_key, version, match_expr, action(allow|soft_gate|deny), timeout_ms, created_at`
- **persona** (new): `persona_id, name, role, concurrency_limit, enabled`
- **artifact** (new): `artifact_id, run_id, op_id, kind(log|json|blob|trace), uri, size_bytes, sha256, created_at`
- **audit_log** (new): `id, actor, action, subject_type, subject_id, metadata, created_at`

Indexes & constraints (MVP)

- `attempt(op_id)` unique; `approval_event(run_id, op_id)`; `dead_letter(run_id)`; partial index on unresolved dead_letters.
- Foreign keys from `approval_event`, `dead_letter`, `artifact` to `runs`.

---

### 7) Namespaces & TTLs

- `team/<team_id>/org/*` (shared SOPs; no TTL; often pinned)
- `team/<team_id>/task/<task_id>/*` (episodic; TTL 7 days, nightly compaction)
- `team/<team_id>/persona/<persona_id>/*` (long-lived; no TTL)

**Importance & decay (defaults)**

- Half-life: 30d episodic, 90d kb, ∞ when `pinned=true`.
- Boost on validated use: +8 (role level), capped at 1000.
- Tiering: hot (indexed) → warm (<10 importance & 90d idle) → cold (warm 180d). Optional delete: cold episodic >365d & not pinned.

Data hygiene

- Nightly compaction for episodic; redact PII on egress; encrypt at rest.

---

### 8) Slack Integration (MVP)

**App & Channels**

- One Slack app / one bot.
- Channels: `#mylo-control` (commands/chat), `#mylo-approvals` (gates), `#mylo-feed` (summaries).
- All run updates posted as threads in `#mylo-feed` keyed by `run_id`.
- DM support for private chat with Orchestrator.
- Deploy mode: Socket Mode (MVP).

**Permissions (scopes)**

- `commands`, `chat:write`, `chat:write.customize`, `channels:read`, `channels:history`, `groups:read`, `im:history`, `im:write`, `mpim:history`.

**Commands (slash)**

- `/mylo new "<goal>" [template=invoice|ticket|status] [noise=low|med|high]`
- `/mylo status [run_id|task_id]`
- `/mylo talk`
- `/mylo stop [run_id]`, `/mylo mute [run_id]`

**Event Handling & Mapping (Socket Mode)**

- Socket Mode handlers for slash commands and interactive actions; verify signatures.
- `notify.action` events forwarded to Orchestrator decision APIs.
- Track `{slack_channel_id, thread_ts}` per `run_id` for in-place updates.

**Message Anatomy (Block Kit)**

- Header: `Run r-8d2 • Health: Extract & Verify`
- Fields: `ExtractorLLM — PASS (4.8s • 153 tokens)`; `used_mem_ids: team/alpha/org/sop/extract.v1`
- Buttons: View Trace, Open Artifacts
- All messages include `team_id, run_id, order_id` (IDs visible + in metadata).

**Approval Card Example**

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Gate: Retry ExtractorLLM?" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Run:* r-8d2" },
        { "type": "mrkdwn", "text": "*Reason:* schema_invalid (code pattern)" }
      ]
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Retry once" },
          "style": "primary",
          "action_id": "approve_retry",
          "value": "r-8d2|op-123"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Skip" },
          "action_id": "approve_skip",
          "value": "r-8d2|op-124"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Abort" },
          "style": "danger",
          "action_id": "approve_abort",
          "value": "r-8d2|op-125"
        }
      ]
    }
  ]
}
```

Rate limits & retries

- Respect Slack retry headers; ensure idempotent action handling by `op_id` and Slack `payload_id`.

---

### 9) Agents & Workflows (MVP)

**Agents (OpenAI Agents SDK)**

- **RecordGen** (CPU/tool-only) → synthetic doc + ground truth.
- **ExtractorLLM** (LLM) → extract fields to strict JSON schema; cite `used_mem_ids`. Model: `gpt-4o-mini`.
- **JsonRestyler** (CPU/tool-only) → normalize/validate output JSON to schema (no new facts).
- **SchemaGuard** (CPU/tool-only) → compare to ground truth; classify fail reason.
- **Persister** (CPU/tool-only) → write summaries to memory.
- **Verifier** (CPU/tool-only) → consistency/hash check.
- **(Optional) SummarizerLLM** → 1–2 sentence recap with citations (feature-flag off by default).

**Health DAG**

`recordgen → extractorLLM → jsonrestyler → schemaguard → persister → verifier → (optional summarizerLLM)`

**Branches**

- `schema_invalid` → soft gate (2 min auto) → one stricter re-prompt → else dead-letter.
- `wrong_value` → no retry (shows real accuracy) → dead-letter.

**LLM Prompts/Decoding**

- System: “Output valid JSON per schema; cite `used_mem_ids` only from provided retrieval; refusal JSON on missing info.”
- `temperature=0`, `top_p=1`, output capped (≤ 200 tokens), input budget (≤ 800 tokens).
- Budget breach → refusal; orchestrator can retry with trimmed context once.

**State machine (simplified)**

- `PENDING → RUNNING → (PASS | DECLINE | ERROR) → (COMPLETE | DEAD_LETTER | RETRY)`

---

### 10) Contracts (Schemas)

**ExtractorLLM Output (v1)**

```json
{
  "type": "object",
  "properties": {
    "extracted_fields": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "code": { "type": "string", "pattern": "^[A-Z]{3}-\\d{4}$" },
        "amount": { "type": "number" },
        "date": { "type": "string", "format": "date" }
      },
      "additionalProperties": false
    },
    "used_mem_ids": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["extracted_fields", "used_mem_ids"],
  "additionalProperties": false
}
```

**Pass/Fail Rules**

- Schema valid AND every ground-truth field matches exactly (date normalized ISO; amount tolerance ±0.01).
- Missing in truth → must be omitted (no hallucinations).
- Otherwise fail with reason: `missing_field | wrong_type | wrong_value | extra_field | pattern_mismatch`.

**WorkOrder (v1)**

```json
{
  "type": "object",
  "properties": {
    "order_id": { "type": "string" },
    "task_id": { "type": "string" },
    "goal": { "type": "string" },
    "input_json": { "type": "object" },
    "namespaces": { "type": "array", "items": { "type": "string" } },
    "cap_token": { "type": "string" },
    "output_schema_id": { "type": "string" },
    "timeout_sec": { "type": "integer", "minimum": 1 },
    "cost_budget_tokens": { "type": "integer", "minimum": 0 }
  },
  "required": [
    "order_id",
    "task_id",
    "goal",
    "input_json",
    "output_schema_id",
    "timeout_sec"
  ],
  "additionalProperties": false
}
```

**ApprovalAction (v1)**

```json
{
  "type": "object",
  "properties": {
    "run_id": { "type": "string" },
    "op_id": { "type": "string" },
    "policy_key": { "type": "string" },
    "decision": {
      "type": "string",
      "enum": [
        "approve_retry",
        "approve_skip",
        "approve_abort",
        "auto_allow",
        "deny"
      ]
    },
    "note": { "type": "string" }
  },
  "required": ["run_id", "op_id", "policy_key", "decision"],
  "additionalProperties": false
}
```

---

### 11) Reliability Rails

- **Leases & heartbeats**: `lease_ttl=30s`, heartbeat every 10s; orchestrator rescues expired leases.
- **Outbox→Bus with consumer inbox**; `orders.complete(op_id)` idempotent.
- **Retry taxonomy**

| Failure class        | Agent return | Orchestrator policy                                  |
| -------------------- | ------------ | ---------------------------------------------------- |
| rate_limit/transient | error        | backoff 1s/4s/10s, max 3                             |
| timeout              | error        | 2 retries                                            |
| schema_invalid (LLM) | decline      | soft_gate 2m auto → 1 stricter re-prompt, else DL    |
| wrong_value (LLM)    | decline      | no retry, DL                                         |
| capability_missing   | decline      | replan                                               |
| tool_error (CPU)     | error        | retry 2×, else DL                                    |

- **Persona mutex**: prevent double checkout.
- **Backpressure**: throttle issuance when bus backlog or DB latency > threshold.
- **Idempotency keys**: per `op_id` and Slack `payload_id`.

---

### 12) Observability & SLOs

- Correlation on every log/metric: `{team_id, run_id, task_id, order_id, step_id, persona_id}`.
- Dashboards: Run Trace, Board Status, Persona Health, Token Spend, Approvals.
- SLOs (MVP): p95 CPU step ≤ 2s; p95 LLM step ≤ 6s; step success ≥ 98%; dead-letters < 1%; token/run ≤ budget.
- Metrics: `tokens_in`, `tokens_out`, `policy_soft_gate_count`, `policy_hard_gate_count`, `auto_approvals`, `human_approvals_latency_ms`.
- Alerts: dead-letters spike, soft-gate timeouts exceeded, budget breaches, Slack error rates.

---

### 13) Cost & Budgets

- Only ExtractorLLM required in MVP.
- Budgets: input ≤ 800 tokens, output ≤ 200; exceed → refusal.
- Budget classes: `low`, `medium`, `high` mapped to numeric caps; policy prevents silent escalation.
- Cost dashboard: tokens per step/run/persona; alert on breach.

---

### 14) Security & Compliance

- Slack: verify signatures (v2), rotate signing secret; scope least-privilege.
- Tokens: JWT capability tokens ≤15 min TTL, audience-bound, HTTPS only.
- Data: encrypt at rest; redact PII in logs; optional PII detector for artifacts.
- Access: role-based approver lists; approval events immutable (append-only).
- Policy (MVP): PII allowed: no; store only synthetic/test data until policies are in place.
- Audit: `audit_log` for all policy changes and escalations.

---

### 15) Testing & Evals

- Golden set: 12 docs (4× invoice, 4× ticket, 4× status) → 100% pass in CI.
- Jailbreak set: prompt-like phrases in doc body → still strict JSON.
- Load: N parallel runs; no lease expirations; meet SLOs.
- Chaos: kill Extractor mid-lease; ensure rescue + idempotent completion.
- Slack tests: `/mylo new`, status, approvals (mocked + manual), idempotent action retries.
- Policy tests: soft gate timeout results in `auto_allow`; hard gate blocks until approval.

---

### 16) Runbooks (Expanded)

- **RB-01 Agent stuck** → no heartbeat → rescue lease → re-issue → notify.
- **RB-02 Dead-letters spike** → check schema drift, reduce issuance, rollback Extractor prompt.
- **RB-03 Bus backlog** → throttle issuance; scale workers; check outbox relay.
- **RB-04 Token storms** → clamp budgets; cheaper model; trim retrieval context.
- **RB-05 Slack noise** → coalesce updates; post summaries only; use ephemeral for FYIs.
- **RB-06 Approval outage** → switch policy to `deny` on risky ops; enable manual CLI override with two-person rule.

---

### 17) Risks & Mitigations

- **JSON drift** → JSON mode + schema; one self-revise; JsonRestyler (no new facts); refusal path.
- **Retrieval junk** → importance scoring + TTL + compaction + diversity filter.
- **Persona saturation** → concurrency caps; autoscale (KEDA later); fair scheduling.
- **Cost overruns** → budgets, per-persona ceilings, refusal fallback.
- **Slack duplication** → idempotent `op_id` handling; verify signatures.
- **Policy misconfig** → policy dry-run mode; canary; audit trail.

---

### 18) Rollout Plan

**Week 1 (MVP)**

- Deploy Postgres, Redis, Temporal.
- Build MCPs: board, memory, notify (Slack adapter), policy.
- Implement agents (RecordGen, ExtractorLLM, JsonRestyler, SchemaGuard, Persister, Verifier).
- Namespaces, capability tokens, leases, retries, idempotent completes.
- Slack app: `/mylo new|status|talk`, approval card; policy soft gates wired.
- Run Trace UI; golden tests pass.

**Weeks 2–3 (Harden)**

- Outbox/inbox everywhere; dead-letter actions; token dashboard.
- Importance sweep/tiering; TTL compaction for `team/<team_id>/task/*`.
- Policy service for scopes/approvals; fairness & concurrency limits; audit dashboard.

**Quarter (Scale)**

- Bus → NATS/Kafka (partition by `task_id`).
- MCP Gateway (auth/rate-limit/audit).
- Vector tiers + re-embed jobs; reward-weighted retrieval.
- Autoscaling workers (KEDA); regional shards as needed.

---

### 19) Open Questions (track until resolved or moved to HITL board)

1. Schema registry location and versioning policy. → Answer: ____
2. Which actions require real human approval (beyond mocked policy)? → Answer: ____
