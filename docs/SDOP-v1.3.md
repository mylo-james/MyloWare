## MyloWare — System Design & Operations Plan (SDOP) v1.3 (MVP → Platform for Digital Work)

### 0) Human-in-the-Loop (HITL) Decision Board

Use this section to record the human decisions that tune policy, risk posture, and operational behavior. Items marked [MVP] must be decided before production MVP launch. The Orchestrator reads these via the Policy MCP. When a decision is changed, add a dated entry in the Change Log and update the effective date here.

**How to use**

- Answer each decision as indicated. If you defer, assign a target date.
- For matrix items, pick one of: Auto (no human), Soft Gate (can auto after timeout), Hard Gate (blocks until human).
- Require justification note on Hard Gate approvals.
- Record approval events to `approval_event` table; retain 365 days.

**Immediate decisions for MVP go/no-go**

- None (captured below)

**Approval Policy Matrix (proposed defaults)**

- LLM wrong value (accuracy failure): Hard Gate (dead-letter + review) → Decision: Hard Gate [MVP]
- Budget increase (token or cost) within +20% of run cap: Soft Gate (auto after 1 min) → Decision: Soft Gate (auto after 1 min) [MVP]
- Budget increase beyond +20% of run cap: Hard Gate → Decision: Hard Gate [MVP]
- Production deploy of policy/prompt: Hard Gate → Decision: Hard Gate [MVP]
- Rewrite of JSON Schemas / Connector Contracts: Hard Gate (requires re-confirmation step by Mylo) → Decision: Hard Gate [MVP]
- Dead-letter re-issue (single attempt): Soft Gate (auto after 5 min) → Decision: Soft Gate (auto after 5 min) [MVP]
- Privacy risk (PII detected): Hard Gate → Decision: Hard Gate [MVP]
- Slack channel creation/permissions changes: Hard Gate → Decision: Hard Gate [MVP]
- Creation/modification of external resources (e.g., GitHub repo, AWS resource, Stripe product): Hard Gate → Decision: Hard Gate
- Outbound email/post to public internet: Soft Gate (auto after 10 min) for non-sensitive, Hard Gate for sensitive → Decision: Conditional — Soft Gate (10 min) for non-sensitive; Hard Gate for sensitive
- Payments (charge/refund/payout): Hard Gate + 2-person rule → Decision: Deny for MVP; Hard Gate + 2-person rule post‑MVP
- Credential scope increases (new OAuth scopes, new cloud IAM roles): Hard Gate → Decision: Hard Gate

**Escalation and SLAs (defaults, propose)**

- Acknowledge within: 5 minutes business hours, 30 minutes off-hours → Decision: Accept [MVP]
- Resolve within: 60 minutes Sev‑2, next business day Sev‑3 → Decision: Accept [MVP]
- Timeout for Soft Gate auto-approval: 2 minutes (unless overridden) → Decision: 2 minutes [MVP]

**Approver roster**

- Approver: Mylo (primary)
- Backup approver: On‑call rotation

---

### 1) Changelog

- v1.3: Elevates MVP into a platform vision. Adds capability/connector registry, typed tool contracts, workflow DSL, multi-surface strategy (Slack + API + later UI), expanded data model (policy, connectors, artifacts, audit), stronger governance (OPA-compatible policy), comprehensive observability, security and compliance posture, and an explicit product roadmap from MVP to multi-tenant, multi-region scale. Deepens HITL policy and risk controls. Introduces development process standards and testing conventions. Adds example schemas, DSL, and approval cards.
- v1.3 update: Rename MVP from “Health: Extract & Verify” to “Docs: Extract & Verify”; clarify Non-Goal: no healthcare/PHI handling in MVP.
- v1.2: Added top-of-doc HITL Decision Board; expanded ADRs, data model, observability, security/compliance, and runbooks. Formalized approval policy matrix and audit model. Clarified Slack scopes, rate limits, and failure handling. Added schema contracts for policy/approvals. Implemented decisions: Extractor model `gpt-4o-mini`, JsonRestyler enabled, Slack Socket Mode, schema_invalid soft gate (2 min), token budgets (800/200), golden set (12 docs), PII not allowed for MVP.
- v1.1: Slack-first interface added (single bot → Orchestrator), human-in-the-loop (HITL) approvals wired via Slack (mocked by policy for MVP).

---

### 2) Vision & Scope

**Vision**

- A secure, governed platform that can orchestrate agents, tools, and services to perform any digital work end-to-end: create, transform, integrate, deploy, and operate digital artifacts across SaaS, code, data, and content surfaces.
- Balance autonomy with verifiability: deterministic orchestration, typed contracts, JSON-schema validation, and policy-enforced HITL for risky actions.

**Scope (Platform categories)**

- Content & Knowledge: authoring, summarization, extraction, classification, knowledge graph curation.
- Software & DevOps: repo scaffolding, code changes via PRs, CI/CD, cloud infra changes via IaC with plans and approvals.
- Data & Analytics: ingestion, transformation, report generation, dashboard updates.
- Commerce & Operations: catalog updates, ticket workflows, CRM updates, billing actions with guardrails.
- Design & Media: asset generation with human review loops; metadata, rights, and publishing.

**MVP focus**

- Documents “Extract & Verify” workflow as the proving ground for the reliability rails and governance. Slack remains the front door.

---

### 3) Product Pillars

- Determinism by design: Temporal workflows, leases, retries, idempotency keys; typed I/O via JSON Schema.
- Governance-first: capability tokens, explicit policy engine outcomes (allow | soft_gate | deny), audit by default.
- Extensibility: first-class connector and tool registry with contract versioning; no hidden side effects.
- Memory with provenance: importance + decay; citations required for LLM outputs.
- Operator-ready: observable, cost-controlled, SLO-backed, with runbooks and incident playbooks.

---

### 4) Goals & Non-Goals (MVP)

**Goals**

- Deterministic workflow execution with recoverability guarantees.
- OpenAI Agents SDK for all agents (CPU steps as tool-only agents; LLM steps only where outputs are strictly verifiable).
- Slack is the front door: `#mylo-control` (commands/chat), `#mylo-approvals` (gates), `#mylo-feed` (summaries).
- Strict namespace fences; capability tokens; importance-scored memory with decay and tiering.
- Operator-ready: SLOs, runbooks, cost budgets, audit logs, and explicit HITL policy.

**Non-Goals (MVP)**

- Multi-org tenancy (use `team_id` only).
- Cross-team federation/auditor agent.
- Rich web UI beyond a minimal Run Trace page.
- Automatic model selection (manual for MVP).
- Healthcare/medical domain features or PHI handling (general document workflows only).

---

### 5) Personas & Primary User Journeys

**Personas**

- Operator: configures policy, reviews approvals, monitors runs.
- Requester: initiates workflows, reviews outcomes.
- Approver: handles gates based on policy and context.
- Developer: builds connectors/tools, templates, and contributes policies.

**User Journeys (MVP)**

1. Start a run from Slack: `/mylo new "Docs: Extract & Verify"` → Orchestrator starts DAG → updates in `#mylo-feed` (threaded by run).
   - Acceptance: thread is created or reused; message includes `run_id`, buttons, latency, token use.
2. HITL gate: policy or error posts an approval card in `#mylo-approvals`.
   - Acceptance: clicking buttons records an `approval_event` and unblocks policy path; soft gates auto-approve after timeout.
3. Ask status: `/mylo status r-123` → compact trace + “View Trace”.
   - Acceptance: returns last 10 steps with outcomes and links.
4. Chat with Orchestrator: `/mylo talk` opens a thread; Orchestrator answers and can spawn work orders.
   - Acceptance: Orchestrator reply references `run_id` and any spawned `task_id`.
5. Review dead-letters: in `#mylo-feed` summary, follow “Open Artifacts” → shows failure artifacts and next actions.

**Future Journeys (Platform)**

- Trigger via API: `POST /runs` with a `workflow_template_id` and parameters.
- GitHub PR flow: bot proposes PR, CI runs golden tests, approver merges after review.
- Notion/Confluence publishing: gated publishing with content DLP.
- Cloud changes: Terraform plan posted; apply needs Hard Gate + 2-person rule.

---

### 6) Architecture (High Level)

```text
Slack App (single bot) / HTTP API
   │  /commands + actions (Block Kit) / POST /runs / GET /runs/:id
   ▼
Notify MCP (Slack adapter) ─────────────────────┐
   │                                            │
   ▼                                            │
Orchestrator (Temporal workflow) ◀── events ────┤
   │ orders                                     │
   ▼                                            │
Board MCP ─ outbox → Bus → Agents → results → Integrator → Memory MCP
                                   (OpenAI Agents SDK)

Control plane: Orchestrator (Temporal), Policy Service (HITL rules), Capability & Connector Registry, Board Librarian (Dispenser), Completed Work Librarian (Integrator).
Data plane: Postgres (truth), Memory MCP (pgvector+KV, tiering), optional object store (artifacts).
Event plane: Redis Streams (MVP) → plan NATS/Kafka.
Secrets: environment vault or KMS-managed secrets.
Compute: Agent workers (OpenAI Agents SDK, autoscale later).
```

Interfaces

- Slack adapter: Socket Mode (MVP) for commands/actions; optional HTTPS events retained for future ingress.
- Policy service: synchronous decision API returning `allow | soft_gate(timeout_ms) | deny(reason)` plus UI metadata.
- Outbox/inbox: at-least-once delivery with idempotent consumers.
- API Surface (MVP+): `POST /runs`, `GET /runs/:id`, `GET /runs/:id/trace`, `POST /approvals`.
- MCP transport: all servers expose MCP endpoints (JSON-RPC 2.0 over WebSocket; HTTP SSE fallback) with capability-token auth and version negotiation.

---

### 7) ADRs (Tech Stack Decisions)

- ADR-001 Orchestration: Temporal for retries, timers, heartbeats, idempotency.
- ADR-002 DB: Postgres (PITR on; partition work tables monthly).
- ADR-003 Bus: Redis Streams now; partitioned NATS/Kafka later.
- ADR-004 Agents: OpenAI Agents SDK everywhere. CPU steps = tool-only with `tool_choice`; LLM steps = JSON schema mode, `temperature=0`.
- ADR-005 Memory: pgvector + KV with importance/decay and hot→warm→cold tiering.
- ADR-006 Auth: JWT capability tokens (≤15 min TTL) with claims `{team_id, run_id, task_id, persona_id, aud[], scopes[], exp}`.
- ADR-007 Contracts: JSON Schema (versioned); Integrator enforces.
- ADR-008 Slack Mode: Socket Mode for MVP (no public ingress required). HTTPS events can be enabled later.
- ADR-009 Schema Registry: store in repo `contracts/` with semantic versioning; Integrator checks compatibility on upgrade.
- ADR-010 Policy Service: Declarative rules (YAML/JSON) + runtime evaluation; approvals stored in `approval_event`.
- ADR-011 Observability: Structured logs (JSON), OpenTelemetry traces/metrics, correlation IDs propagated end-to-end.
- ADR-012 Secrets: Rotate Slack signing secret and bot token quarterly; no secrets in logs.
- ADR-013 Policy Engine Compatibility: plan OPA/Rego adapter for complex org policy.
- ADR-014 Connector Packaging: connectors defined as signed bundles with contract + tests.
- ADR-015 MCP Everywhere: every server must be MCP-compliant. Transport: JSON-RPC 2.0 over WebSocket (preferred), HTTP SSE fallback; identity via short-lived capability tokens or mTLS; standard methods for handshake (`mcp.hello`), discovery (`mcp.tools.list`, `mcp.schemas.list`), execution (`mcp.tools.call`), events/streams, health, and version negotiation.

---

### 8) Extensibility: Capabilities, Tools, Connectors

**Concepts**

- Capability: a typed verb on a resource (e.g., `repo.create`, `email.send`, `doc.extract`).
- Tool: a concrete implementation of a capability with a strict input/output schema and side-effect policy.
- Connector: a collection of tools for a surface (GitHub, Slack, Notion, AWS, Stripe, Figma, Google, Vercel…).

**Tool Contract (v1)**

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "capability": { "type": "string" },
    "version": { "type": "string" },
    "input_schema": { "type": "object" },
    "output_schema": { "type": "object" },
    "side_effects": {
      "type": "string",
      "enum": ["none", "read", "write", "external"]
    },
    "sensitivity": {
      "type": "string",
      "enum": ["low", "medium", "high", "critical"]
    },
    "scopes": { "type": "array", "items": { "type": "string" } }
  },
  "required": [
    "name",
    "capability",
    "version",
    "input_schema",
    "output_schema",
    "side_effects"
  ]
}
```

**Connector Definition (v1)**

```json
{
  "type": "object",
  "properties": {
    "connector_id": { "type": "string" },
    "vendor": { "type": "string" },
    "version": { "type": "string" },
    "tools": { "type": "array", "items": { "type": "object" } },
    "auth": {
      "type": "object",
      "properties": {
        "kind": { "type": "string" },
        "scopes": { "type": "array", "items": { "type": "string" } }
      }
    }
  },
  "required": ["connector_id", "vendor", "version", "tools"]
}
```

**Registry**

- Store connector manifests in `contracts/connectors/`. Each tool has a unique `name@version` and schema.
- Registry powers capability tokens: a token’s `scopes[]` must include the tool or capability being invoked.
- Policy may deny or gate based on `side_effects` or `sensitivity`.

---

### 9) Workflow Model & DSL

**Workflow Concepts**

- Template: parameterized DAG with typed steps.
- Order: an instantiation of a template with inputs and budgets.
- Step: agent + tool invocation with contracts and policies.

**Workflow Template (v1)**

```json
{
  "type": "object",
  "properties": {
    "template_id": { "type": "string" },
    "name": { "type": "string" },
    "parameters": { "type": "object" },
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "agent": { "type": "string" },
          "tool": { "type": "string" },
          "input": { "type": "object" },
          "expects": { "type": "string" },
          "on_error": {
            "type": "string",
            "enum": ["retry", "gate", "dead_letter"]
          }
        },
        "required": ["id", "agent", "tool", "input", "expects"]
      }
    }
  },
  "required": ["template_id", "name", "steps"]
}
```

**Mapping to Temporal**

- Each step maps to an Activity with idempotency by `op_id`. Retries and timers are defined per step.
- Gates are raised as approval cards with context from step metadata.

---

### 10) Agents & Workflows (MVP)

**Agents (OpenAI Agents SDK)**

- RecordGen (CPU/tool-only) → synthetic doc + ground truth.
- ExtractorLLM (LLM) → extract fields to strict JSON schema; cite `used_mem_ids`. Model: `gpt-4o-mini`.
- JsonRestyler (CPU/tool-only) → normalize/validate output JSON to schema (no new facts).
- SchemaGuard (CPU/tool-only) → compare to ground truth; classify fail reason.
- Persister (CPU/tool-only) → write summaries to memory.
- Verifier (CPU/tool-only) → consistency/hash check.
- (Optional) SummarizerLLM → 1–2 sentence recap with citations (feature-flag off by default).

**Extract & Verify DAG**

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

### 11) Data Model (Core + Platform)

Core (MVP)

- work_order: `order_id, task_id, step_id, goal, input_json, namespaces[], cap_token, output_schema_id, timeout_sec, cost_budget_tokens, attempt, lease_id, lease_ttl`
- work_item: `id, task_id, assigned_persona_id, status, depends_on[], vars_json, priority, created_at, updated_at`
- attempt: `attempt_id, order_id, started_at, ended_at, outcome, error, op_id`
- event_outbox / event_inbox: reliable pub/sub bridge
- runs: `run_id, team_id, slack_channel_id, slack_thread_ts`
- mem_doc: `id, team_id, namespace, text, tags[], class(kb|episodic|log), embedding, quality_score, created_at`
- mem_actor_importance: `doc_id, actor_key(role:fe-dev…), raw_score, last_update_at, last_used_at, use_7d, use_30d`
- mem_use_event: `doc_id, actor_key, run_id, ts, weight`
- approval_event: `id, run_id, op_id, approver, policy_key, decision(allow|auto_allow|deny|abort|skip|retry), reason, note, created_at`
- dead_letter: `id, run_id, op_id, reason_code, payload, created_at, resolved_at, resolver`
- policy_rule: `policy_key, version, match_expr, action(allow|soft_gate|deny), timeout_ms, created_at`
- persona: `persona_id, name, role, concurrency_limit, enabled`
- artifact: `artifact_id, run_id, op_id, kind(log|json|blob|trace), uri, size_bytes, sha256, created_at`
- audit_log: `id, actor, action, subject_type, subject_id, metadata, created_at`

Platform (new)

- connector: `connector_id, vendor, version, manifest_json, enabled`
- tool: `tool_id, name, capability, version, connector_id, input_schema_id, output_schema_id, side_effects, sensitivity`
- capability: `capability_key, description, default_policy`
- schema: `schema_id, version, json, semver_parent, created_at`
- workflow_template: `template_id, name, version, steps_json, created_at, author`
- eval_result: `id, run_id, step_id, metric_key, metric_value, created_at`
- incident: `incident_id, severity, run_id, summary, created_at, resolved_at`

Indexes & constraints

- `attempt(op_id)` unique; `approval_event(run_id, op_id)`; `dead_letter(run_id)`; partial index on unresolved dead_letters.
- Foreign keys from `approval_event`, `dead_letter`, `artifact` to `runs`.

---

### 12) Namespaces & TTLs

- `team/<team_id>/org/*` (shared SOPs; no TTL; often pinned)
- `team/<team_id>/task/<task_id>/*` (episodic; TTL 7 days, nightly compaction)
- `team/<team_id>/persona/<persona_id>/*` (long-lived; no TTL)

Importance & decay (defaults)

- Half-life: 30d episodic, 90d kb, ∞ when `pinned=true`.
- Boost on validated use: +8 (role level), capped at 1000.
- Tiering: hot (indexed) → warm (<10 importance & 90d idle) → cold (warm 180d). Optional delete: cold episodic >365d & not pinned.
- Nightly compaction for episodic; redact PII on egress; encrypt at rest.

---

### 13) Slack Integration (MVP) + Future Surfaces

App & Channels

- One Slack app / one bot.
- Channels: `#mylo-control` (commands/chat), `#mylo-approvals` (gates), `#mylo-feed` (summaries).
- All run updates posted as threads in `#mylo-feed` keyed by `run_id`.
- DM support for private chat with Orchestrator.
- Deploy mode: Socket Mode (MVP).

Permissions (scopes)

- `commands`, `chat:write`, `chat:write.customize`, `channels:read`, `channels:history`, `groups:read`, `im:history`, `im:write`, `mpim:history`.

Commands (slash)

- `/mylo new "<goal>" [template=invoice|ticket|status] [noise=low|med|high]`
- `/mylo status [run_id|task_id]`
- `/mylo talk`
- `/mylo stop [run_id]`, `/mylo mute [run_id]`

Event Handling & Mapping (Socket Mode)

- Socket Mode handlers for slash commands and interactive actions; verify signatures.
- `notify.action` events forwarded to Orchestrator decision APIs.
- Track `{slack_channel_id, thread_ts}` per `run_id` for in-place updates.

Message Anatomy (Block Kit)

- Header: `Run r-8d2 • Docs: Extract & Verify`
- Fields: `ExtractorLLM — PASS (4.8s • 153 tokens)`; `used_mem_ids: team/alpha/org/sop/extract.v1`
- Buttons: View Trace, Open Artifacts
- All messages include `team_id, run_id, order_id` (IDs visible + in metadata).

Approval Card Example

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

Future surfaces

- REST API (MVP+), Web UI (Run Trace, Approvals), CLI, GitHub App, Notion/Confluence publisher.

---

### 14) Policy, Governance & HITL

Outcomes

- `allow`, `soft_gate(timeout_ms)`, `deny(reason)` with UI metadata for approval cards.

Policy inputs

- Capability/tool metadata, step context, persona role, cost deltas, data classification (PII), environment (prod vs test).

Defaults (MVP)

- PII allowed: no; store only synthetic/test data until policies are in place.
- Hard caps: input ≤ 800, output ≤ 200 tokens; refusal instead of overspending.

Auditability

- All policy decisions recorded as `approval_event` and `audit_log` entries. Immutable, 365-day retention.

Escalations

- Soft gates auto-approve after timeout. Hard gates require approver note. Critical actions require 2-person rule.

OPA compatibility (future)

- Provide Rego policy adapter for enterprise governance. Continue to persist outcomes in our model.

---

### 15) Reliability Rails

- Leases & heartbeats: `lease_ttl=30s`, heartbeat every 10s; orchestrator rescues expired leases.
- Outbox→Bus with consumer inbox; `orders.complete(op_id)` idempotent.
- Retry taxonomy

| Failure class        | Agent return | Orchestrator policy                               |
| -------------------- | ------------ | ------------------------------------------------- |
| rate_limit/transient | error        | backoff 1s/4s/10s, max 3                          |
| timeout              | error        | 2 retries                                         |
| schema_invalid (LLM) | decline      | soft_gate 2m auto → 1 stricter re-prompt, else DL |
| wrong_value (LLM)    | decline      | no retry, DL                                      |
| capability_missing   | decline      | replan                                            |
| tool_error (CPU)     | error        | retry 2×, else DL                                 |

- Persona mutex to prevent double checkout; backpressure on bus backlog/DB latency; idempotency by `op_id` and Slack `payload_id`.

---

### 16) Observability & SLOs

- Correlation on every log/metric: `{team_id, run_id, task_id, order_id, step_id, persona_id}`.
- Dashboards: Run Trace, Board Status, Persona Health, Token Spend, Approvals, Connectors Health.
- SLOs (MVP): p95 CPU step ≤ 2s; p95 LLM step ≤ 6s; step success ≥ 98%; dead-letters < 1%; token/run ≤ budget.
- Metrics: `tokens_in`, `tokens_out`, `policy_soft_gate_count`, `policy_hard_gate_count`, `auto_approvals`, `human_approvals_latency_ms`, `connector_error_rate`.
- Alerts: dead-letters spike, soft-gate timeouts exceeded, budget breaches, Slack error rates.

---

### 17) Security & Compliance

- Slack: verify signatures (v2), rotate signing secret; scope least-privilege.
- Tokens: JWT capability tokens ≤15 min TTL, audience-bound, HTTPS only.
- Data: encrypt at rest; redact PII in logs; optional PII detector for artifacts.
- Access: role-based approver lists; approval events immutable (append-only).
- Policy (MVP): PII allowed: no; store only synthetic/test data until policies are in place.
- Audit: `audit_log` for all policy changes and escalations.
- Compliance roadmap: SOC 2 controls (change management, access reviews, logging), DLP classifier for outbound content.
- MCP compliance: all servers implement the MCP handshake, discovery, tool-execution, and health endpoints; tokens scoped to capabilities; deny by default; explicit allow lists per connector.

---

### 18) Cost & Budgets

- Only ExtractorLLM required in MVP.
- Budgets: input ≤ 800 tokens, output ≤ 200; exceed → refusal.
- Budget classes: `low`, `medium`, `high` mapped to numeric caps; policy prevents silent escalation.
- Cost dashboard: tokens per step/run/persona; alert on breach.

---

### 19) Testing, Evals & Engineering Process

Testing strategy

- Golden set: 12 docs (4× invoice, 4× ticket, 4× status) → 100% pass in CI.
- Jailbreak set: prompt-like phrases in doc body → still strict JSON.
- Load: N parallel runs; no lease expirations; meet SLOs.
- Chaos: kill Extractor mid-lease; ensure rescue + idempotent completion.
- Slack tests: `/mylo new`, status, approvals (mocked + manual), idempotent action retries.
- Policy tests: soft gate timeout results in `auto_allow`; hard gate blocks until approval.
- MCP compliance tests: handshake (`mcp.hello`), discovery (`mcp.tools.list`, `mcp.schemas.list`), auth failure (401/403), tool call happy-path and schema-validation failure, backpressure behavior, heartbeat/keepalive, and version negotiation.

Engineering workflow

- Trunk hygiene: pull main, branch per change, write failing tests first (TDD), implement to green, refactor, ensure hooks run, commit, PR, CI green, merge.
- Test conventions: JavaScript tests as `*.test.ts`.

---

### 20) Runbooks & Incident Management

- RB‑01 Agent stuck → no heartbeat → rescue lease → re-issue → notify.
- RB‑02 Dead-letters spike → check schema drift, reduce issuance, rollback Extractor prompt.
- RB‑03 Bus backlog → throttle issuance; scale workers; check outbox relay.
- RB‑04 Token storms → clamp budgets; cheaper model; trim retrieval context.
- RB‑05 Slack noise → coalesce updates; post summaries only; use ephemeral for FYIs.
- RB‑06 Approval outage → policy to `deny` on risky ops; enable manual CLI override with two-person rule.
- RB‑07 Connector outage → degrade to read-only tools; circuit-break write tools; post status to `#mylo-feed`.

---

### 21) Rollout Plan

Week 1 (MVP)

- Deploy Postgres, Redis, Temporal.
- Build MCPs: board, memory, notify (Slack adapter), policy.
- Implement agents (RecordGen, ExtractorLLM, JsonRestyler, SchemaGuard, Persister, Verifier).
- Namespaces, capability tokens, leases, retries, idempotent completes.
- Slack app: `/mylo new|status|talk`, approval card; policy soft gates wired.
- Run Trace UI; golden tests pass.

Weeks 2–3 (Harden)

- Outbox/inbox everywhere; dead-letter actions; token dashboard.
- Importance sweep/tiering; TTL compaction for `team/<team_id>/task/*`.
- Policy service for scopes/approvals; fairness & concurrency limits; audit dashboard.

Quarter (Scale)

- Bus → NATS/Kafka (partition by `task_id`).
- MCP Gateway (auth/rate-limit/audit).
- Vector tiers + re-embed jobs; reward-weighted retrieval.
- Autoscaling workers (KEDA); regional shards as needed.

---

### 22) Risks & Mitigations

- JSON drift → JSON mode + schema; one self-revise; JsonRestyler (no new facts); refusal path.
- Retrieval junk → importance scoring + TTL + compaction + diversity filter.
- Persona saturation → concurrency caps; autoscale (KEDA later); fair scheduling.
- Cost overruns → budgets, per-persona ceilings, refusal fallback.
- Slack duplication → idempotent `op_id` handling; verify signatures.
- Policy misconfig → policy dry-run mode; canary; audit trail.
- Connector security drift → scheduled scope audits; least-privilege defaults; alert on scope deltas.

---

### 23) Contracts (Schemas)

ExtractorLLM Output (v1)

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

Pass/Fail Rules

- Schema valid AND every ground-truth field matches exactly (date normalized ISO; amount tolerance ±0.01).
- Missing in truth → must be omitted (no hallucinations).
- Otherwise fail with reason: `missing_field | wrong_type | wrong_value | extra_field | pattern_mismatch`.

WorkOrder (v1)

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

ApprovalAction (v1)

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

### 24) Open Questions

1. Schema registry persistence beyond repo (`contracts/`) — move to lightweight service for connector contracts? → Answer: Yes, Phase 2: promote repo registry to a lightweight service with read‑through caching and compatibility checks. Source of truth remains in git; service adds discovery, version negotiation, and audit.
2. Which actions require real human approval (beyond mocked policy)? → Answer: Hard Gate for schema/policy changes, external writes, credential scope increases, public posting of sensitive content, and production deploys; Soft Gate for ≤20% budget increases and single dead‑letter re‑issue; payments denied in MVP.
3. Minimal API surface for MVP+ (`POST /runs`, `GET /runs/:id/trace`) — timing and auth model? → Answer: Week 3; capability‑token auth (≤15m TTL), audience‑bound; endpoints `POST /runs`, `GET /runs/:id/trace`.
4. First three connectors to ship post-MVP (GitHub, Notion, Vercel?) → Answer: GitHub, Google Drive/Sheets, Notion.
5. DLP/PII detection vendor vs in-house? → Answer: Phase 1: regex/heuristics; Phase 2: vendor (e.g., Google DLP or Presidio) with allow/deny lists and audit.

---

### 25) Glossary

- Agent: a runnable that can call tools and return typed outputs; often backed by OpenAI Agents SDK.
- Tool: a typed function exposed to agents with JSON input/output and declared side effects.
- Connector: a package of tools bound to a surface/vendor, with versioned contracts.
- Capability: a named verb on a resource (e.g., `email.send`).
- Policy: evaluation that produces `allow | soft_gate | deny` with optional timeout and reason.
- Gate: a HITL approval checkpoint emitted by policy or orchestrator.
- Artifact: any persisted byproduct (log/json/blob/trace) tied to `run_id` and `op_id`.

---

### 26) MCP Compliance Profile (v1)

Mandatory for every server (MVP+):

- Transport: JSON-RPC 2.0 over WebSocket (primary); HTTP SSE/long-poll fallback permitted.
- Auth: short-lived capability tokens (≤15m) or mTLS; audience-bound; least-privilege scopes.
- Handshake: `mcp.hello` returns `{server_name, version, capabilities}`.
- Discovery: `mcp.tools.list`, `mcp.schemas.list` expose tools and JSON Schemas with versions.
- Invocation: `mcp.tools.call` takes typed input, returns typed output; schema-validated both ways.
- Health: `mcp.health` returns `{status, uptime_ms, load}`; emits events for degraded/overload.
- Streaming/events: server may emit `mcp.event` frames for progress and logs; clients correlate via `op_id`.
- Backpressure: servers may signal `retry_after_ms` and enforce rate limits per token.
- Version negotiation: `mcp.hello` includes supported protocol versions; clients select the highest mutual.
- Observability: correlation IDs on all frames; emit metrics for calls, errors, latency; audit tool calls with subject and capability.

---

### 27) Platform Evolution & Product Crews (Vision)

### North Star

- Governed AI product crews that take a PRD or idea, plan the work, execute across connectors, request approvals at gates, and ship verifiable outcomes—end‑to‑end, repeatedly.

### Operating model (built on today’s SDOP)

- Crews = `personas` + connectors + workflow templates + policies. Knowledge lives in namespaces (`team/<team_id>/persona/<persona_id>/*`) with importance/decay and citations.
- Orchestrator runs typed workflows (JSON‑schema contracts) with deterministic execution (Temporal), capability‑scoped tokens, and HITL policy (`allow | soft_gate | deny`, 2‑person rules).
- Surfaces: Slack front‑door now; REST API and GitHub/CLI entry points next; minimal Web UI for Run Trace/Approvals.

### Why we win (moats)

- Determinism and typed I/O over prompt‑only tools; idempotent completion and audit by default.
- Policy/HITL governance and least‑privilege capability tokens.
- MCP‑compliant connector/tool ecosystem with versioned contracts.
- Memory with provenance (importance + decay + required citations).

### Evolution milestones

- MVP (now): Docs “Extract & Verify” on Slack; golden set; Run Trace; policy rails; budgets; audit.
- Platformize (30–60 days): connector registry + capability tokens in use; workflow DSL solid; REST API (`POST /runs`, `GET /runs/:id/trace`); GitHub PR flow; Sheets/CSV export; approvals dashboard.
- Product Crews (60–120 days): prebuilt templates (`product_sprint.v1`, `content_campaign.v1`, `affiliate_launch.v1`); crew KB bootstrap; role concurrency/fairness; publishing connectors behind Hard Gates.
- Enterprise scale (120–180 days): multi‑tenant teams, OPA/Rego policy adapter, SOC 2 controls, MCP Gateway, autoscaling workers, optional regional shards.

### Future crews (illustrative, not implemented in MVP)

- Web Dev: PRD → plan backlog → create PRs → preview deploys → gated prod release.
- Content: PRD → scripts/assets → editorial review → scheduled publishing (Hard Gate to post).
- Affiliate: offers/UTMs → landing pages → price/asset changes (gated) → weekly performance report.

### KPIs across maturity

- Reliability: step success ≥ 98%, dead‑letters < 1%, p95 CPU ≤ 2s, p95 LLM ≤ 6s.
- Governance: human touch rate trending down, approval latency within SLA, zero ungated risky writes.
- Efficiency/ROI: tokens/run within budgets, time‑to‑ship vs baseline, hours/$ saved per crew.

### Open items to unlock the vision

- Finalize schema/connector registry promotion path (repo → service) and version policy.
- Minimal public API allowlist and auth model (capability tokens) for partner teams.
- First three platform connectors (proposed): GitHub, Google Drive/Sheets, Notion; publishing connectors gated by default.

---

### 28) Commercialization & GTM (MVP → 90 days)

- ICP: teams with repetitive document intake/transformation (invoices, tickets, status reports) using Slack and GitHub/Google.
- Value prop: faster, governed document workflows with typed contracts, audit, and approvals; Slack-first; verifiable outputs.
- Pricing (initial): usage-based by successful step/run with token caps; free developer tier; paid team tier with SLOs and audit retention.
- Pilot motion: 3 design partners; weekly SLO/ROI report; golden set co-created; HITL tuned with their policies.
- Metrics: time-to-first-successful-run, approval latency, dead-letter rate, tokens/run, human touch rate.

---

### 29) MVP Launch Checklist

- Slack app installed and verified in a real workspace; Socket Mode enabled; scopes approved.
- Policy service live with default rules; approval cards functioning; audit log retention verified.
- Golden tests (12 docs) pass in CI; `/mylo new|status|talk` commands work.
- Run Trace UI deployed; correlation IDs present end-to-end; basic dashboards up.
- Postgres/Redis/Temporal deployed with backups and monitoring; lease rescue verified.
- Docs updated: READMEs, quickstart, incident runbooks; on-call rota defined.
