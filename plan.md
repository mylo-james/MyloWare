# Orchestration Strategy — Handoff‑First Plan (Standardized SQL + runId)

**Inspection status:** ✅ Plan reviewed; all listed changes approved with no blockers.

This plan pivots to a handoff‑first architecture per direction: standardize SQL and the identifier name, focus on persona→persona handoff, and exclude HITL and dates. It replaces the earlier recursive/trace plan.

- Proposals considered: `codex-handoff-proposal.md` and `codex-recursive-agent-proposal.md`.
- Decision: implement the handoff model now with a single canonical identifier `runId` threaded end‑to‑end.

---

## Standards (must‑follow)

- Identifier: `runId` (camelCase) in application payloads and n8n; SQL tables keep `id uuid` as PK. When returning rows via MCP tools, include `runId` = row `id` for clarity.
- SQL naming: snake_case table/columns; timestamps `created_at`, `updated_at`; enums as text with constrained values.
- Memory: all episodic memories for a run include metadata `{ runId, handoffId? }`; content is single‑line; use `relatedTo` for chaining.
- n8n: no `$fromAI('…')`. Every toolWorkflow input explicitly receives `runId` from the bootstrap node.

---

## Target Architecture (handoff)

- Deterministic state in SQL (authoritative): `agent_runs`, `handoff_tasks`, `run_events`.
- Narrative context in RAG: episodic memories tagged with `{ runId }` and linked.
- Standard handoff protocol: update SQL first, then write memory, then invoke the next persona/workflow with the canonical `runId`.

### Canonical State Machine
`new → in_progress → blocked | delegated → in_progress → completed | failed`
- Fields: `current_step text`, `custodian_agent text`, `locked_at timestamp` (lease), `state_blob jsonb` for small working vars.

---

## Database Changes (authoritative)

Add three tables (aligning with `codex-handoff-proposal.md`).

```sql
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  persona text NOT NULL,
  project text NOT NULL,
  instructions text,
  current_step text,
  status text NOT NULL,
  state_blob jsonb NOT NULL DEFAULT '{}',
  custodian_agent text,
  locked_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE handoff_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  from_persona text,
  to_persona text NOT NULL,
  task_brief text,
  required_outputs jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  custodian_agent text,
  locked_at timestamp,
  completed_at timestamp,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor text,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamp DEFAULT now()
);

CREATE INDEX handoff_tasks_run_id_idx ON handoff_tasks(run_id);
CREATE INDEX run_events_run_id_idx ON run_events(run_id);
```

Notes:
- Keep existing `sessions`, `workflow_runs`, and `memories` as‑is.
- Do not add `execution_traces` (not needed for handoff‑first).

---

## MCP Tools (orchestration)

Implement these minimal tools to avoid bespoke SQL from prompts/LLM:

- `run_state.createOrResume({ sessionId, persona, project, instructions? }) → { runId }`
- `run_state.read({ runId }) → agent_runs`
- `run_state.update({ runId, patch }) → { ok: true }`
- `run_state.appendEvent({ runId, eventType, payload }) → { ok: true }`
- `handoff.create({ runId, toPersona, taskBrief, requiredOutputs? }) → { handoffId }`
- `handoff.claim({ handoffId, agentId, ttlMs }) → { status: 'locked'|'conflict' }`
- `handoff.complete({ handoffId, outputs?, notes?, status }) → { ok: true }`
- `handoff.listPending({ runId, persona }) → [ ... ]`
- `memory.searchByRun({ runId, persona?, project?, k? })` (wrapper over `memory_search` with filters)

All tool responses include `runId`/`handoffId` where relevant.

---

## n8n Agent Workflow Changes

1) Bootstrap Run
- Add an MCP call to `run_state.createOrResume` immediately after the Telegram trigger (or `When Executed by Another Workflow`).
- Capture `runId` in the workflow context; expose as `={{ $json.runId }}`.

2) Replace `$fromAI('runId', …)`
- In `workflows/agent.workflow.json` replace every usage (currently at lines 89, 126, 163, 201) with the bound `runId` variable.
- Ensure every toolWorkflow node includes a `runId` input parameter.

3) Standard Handoff Macro
- Pattern for persona delegation:
  - `handoff.create({ runId, toPersona, taskBrief, requiredOutputs })`
  - `run_state.appendEvent({ runId, eventType: 'handoff_created', payload: { handoffId, toPersona } })`
  - Call `Agent Workflow` with inputs `{ persona: toPersona, project, instructions, runId }`.

4) Memory Discipline
- After each meaningful step, write one episodic memory with `{ runId, handoffId? }` in metadata; chain via `relatedTo`.

Excluded:
- No HITL nodes (`sendAndWait`) required; we keep pure handoff flow.

---

## Implementation Steps (sequential)

1. Schema
- Add the three tables + indexes to `src/db/schema.ts` and create a migration.

2. Repository Layer
- Add `src/db/repositories/run-repository.ts` and `handoff-repository.ts` with claim/lease helpers.

3. MCP Tools
- Implement the `run_state.*`, `handoff.*`, and `memory.searchByRun` wrappers in `src/mcp/tools.ts`.

4. Server Wiring
- Ensure tools are registered via `registerMCPTools`; expose in `/health` tool list.

5. n8n Workflow
- Add “Bootstrap Run” node and propagate `runId` to all toolWorkflow nodes.
- Replace `$fromAI('runId', …)` and validate each node receives `runId`.

6. Memory Enforcement
- Add a tiny helper around `memory_store` to inject `{ runId, handoffId? }` automatically; use it in the agent prompt.

7. Tests
- Unit: repositories and MCP tools (create, claim(lease TTL), complete, listPending, appendEvent).
- E2E: Persona A → Persona B → Persona A round‑trip with assertions:
  - `agent_runs.status` transitions
  - `handoff_tasks` created/claimed/completed
  - `run_events` append order
  - Memories tagged with `runId`

8. Observability
- Add basic SQL queries and a sample `memory_search` query for `runId` to `docs/OBSERVABILITY.md`.

---

## Acceptance Criteria

- Every workflow start yields a `runId` in `agent_runs`; all subsequent nodes receive the same `runId`.
- Handoffs are created and consumed via tools; leases prevent double work.
- No `$fromAI('runId', …)` usages remain in `workflows/agent.workflow.json`.
- `run_events` shows a coherent audit trail; episodic memories include `{ runId }`.

---

## Risks & Mitigations

- Lease contention → `handoff.claim` enforces TTL (e.g., 300000 ms) and returns conflict info.
- Orphaned handoffs → periodic scan for expired `locked_at` to reset `status` to `pending`.
- Inconsistent tagging → wrap `memory_store` to auto‑inject `{ runId }`.
- Over‑coordination → keep tools thin; store only what’s necessary for custody and audit.

---

## Notes

- Dates/go‑live are intentionally omitted.
- HITL is out of scope for this pass.
