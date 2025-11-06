# Codex Handoff Proposal

Version: 0.1
Date: 2025-11-06
Owner: Orchestration / MCP

## 1) Overview
This proposal formalizes “sudo handoff” orchestration across personas using our current stack: n8n agent workflow, MCP tools, and Postgres+pgvector RAG. Deterministic state (SQL) governs custody, steps, and completion; RAG mirrors the narrative for retrieval and reasoning. Any agent can resume a run by reading SQL first, then pulling contextual memories filtered by persona, project, and run.

## 2) Goals / Non‑Goals
- Goals
  - Reliable persona→persona handoffs with single source of truth.
  - Zero hallucinated IDs (canonical `runId` everywhere).
  - Uniform system prompt Contract for agents to: read state, do work, log events, store memory, and delegate.
  - Seamless fit with existing memory store/search (pgvector) and n8n workflows.
- Non‑Goals
  - New databases or external schedulers.
  - Replacing n8n; we extend and standardize how the agent uses it.

## 3) Current State (summary)
- Memory: `memories` (pgvector, 1536d), metadata for persona/project/tags; auto summary and linking (docs/ARCHITECTURE.md).
- Config: `personas`, `projects`; runtime `sessions`, `workflow_runs`; `workflow_registry` maps memories to n8n workflow ids (drizzle migrations).
- Workflow: `workflows/agent.workflow.json` routes Telegram → AI Agent with MCP tools and tool workflows. Several tool calls expect `runId` but rely on `$fromAI('runId', …)`.

## 4) Proposed Architecture
- Deterministic State (SQL): authoritative run + task/custody. All routing decisions read/write SQL.
- Narrative Memory (RAG): episodic summaries and decisions tagged with `{runId, persona, project}` for retrieval.
- Standard Handoff Protocol: agents must update SQL first, then write memory, then call the next persona/workflow.

### 4.1 State Machine (canonical)
Statuses (for `agent_runs.status`): `new → in_progress → blocked | delegated → in_progress → completed | failed`
- `current_step`: free‑text or enum (e.g., `ideation`, `edit`, `upload`).
- Custody: `custodian_agent` + `locked_at` (lease) to prevent double work.

## 5) Data Model (additions)
We extend the existing schema (keep `memories`, `sessions`, `workflow_runs`).

- `agent_runs`
  - `id uuid PK` (aka `runId`), `session_id text`, `persona text`, `project text`,
    `instructions text`, `current_step text`, `status text`, `state_blob jsonb`,
    `custodian_agent text`, `locked_at timestamp`, timestamps.
- `handoff_tasks`
  - `id uuid PK`, `run_id uuid FK(agent_runs)`, `from_persona text`, `to_persona text`,
    `task_brief text`, `required_outputs jsonb`, `status text`(pending|in_progress|returned|done),
    `custodian_agent text`, `locked_at timestamp`, `completed_at timestamp`, `metadata jsonb`, timestamps.
- `run_events`
  - append‑only: `id uuid PK`, `run_id uuid`, `event_type text`, `actor text`, `payload jsonb`, `created_at timestamp`.

### 5.1 Suggested DDL (sketch)
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

## 6) MCP Tools (SQL + RAG wrappers)
Expose as MCP tools so any persona can orchestrate without bespoke SQL.
- `run_state.createOrResume({ sessionId, persona, project, instructions, message }) → { runId }`
- `run_state.read({ runId }) → agent_runs`
- `run_state.update({ runId, patch })`
- `run_state.appendEvent({ runId, eventType, payload })`
- `handoff.create({ runId, toPersona, taskBrief, requiredOutputs }) → { handoffId }`
- `handoff.claim({ handoffId, agentId, ttlMs }) → lock | conflict`
- `handoff.complete({ handoffId, outputs, notes, status })`
- `handoff.listPending({ runId, persona })`
- `memory.searchByRun({ runId, persona?, project?, k })` (filters memories by metadata)
- Use existing `memory_store` for episodic writes, with enforced metadata below.

## 7) Memory Conventions (RAG)
All memories written during orchestration include:
```json
{
  "memoryType": "episodic",
  "project": ["<project>"],
  "persona": ["<persona>"],
  "tags": ["handoff", "orchestration"],
  "metadata": { "runId": "<uuid>", "handoffId": "<optional>" }
}
```
Retrieval: filter by `project`, optional `persona`, and `metadata.runId`. This mirrors the persona/project‑aware retrieval guidance in docs/rag_docs.txt and keeps long‑running runs coherent.

## 8) n8n Workflow Changes
File: `workflows/agent.workflow.json`
- Before `AI Agent`: add a Function (or HTTP/MCP) node to `createOrResume` run and emit the canonical `runId`.
- Inject into `AI Agent` system prompt:
  - persona, project, instructions
  - runId and current_step/status snapshot
  - brief tool catalog: `run_state`, `handoff`, `memory_store`, `memory.searchByRun`, Telegram HITL
- Replace the placeholder `Switch` with SQL‑driven branching:
  - If run blocked → ask user (Telegram sendAndWait) or escalate
  - If pending handoff to specific persona → call `Call 'Agent Workflow'` with persona/project/instructions and `runId`
- Ensure all tool workflow nodes (Edit/Generate/Upload/Drive) accept `runId` from the state node, not `$fromAI()`.

## 9) System Prompt Contract (template)
Key rules to embed as system message in `AI Agent`:
1. Read state first: `run_state.read(runId)` before decisions.
2. When you finish a step, update `agent_runs.current_step` and `status`.
3. Log an event for every material action (`run_state.appendEvent`).
4. Store an episodic memory summarizing what changed (`memory_store` with runId).
5. For handoff: create a `handoff_tasks` row (toPersona + machine‑readable `required_outputs`), then call the target persona workflow with `runId`.
6. On receipt of a handoff: `handoff.claim` → work → `handoff.complete` → decide to finish or re‑delegate.
7. Never invent `runId` or external IDs; always use provided values.

## 10) Handoff Lifecycle (happy path)
1. Trigger (Telegram or API) → `createOrResume` returns `runId`.
2. Agent claims custody (lease) and sets `status=in_progress`.
3. Agent uses tools, produces outputs; writes memory summary with `runId`.
4. Agent decides next step → `handoff.create` (to persona X) + event + memory.
5. n8n invokes `Agent Workflow` for persona X with `runId`.
6. Persona X `handoff.claim` → executes → `handoff.complete`.
7. If work done, mark `agent_runs.status=completed`; else continue.

### 10.1 Errors / Retries
- Leases expire: if `locked_at` + TTL elapsed, another worker may claim.
- `handoff.claim` returns conflict → agent re‑reads state and aborts work.
- Failed tool calls → append `run_events` with `event_type='error'` and retry policy (exponential backoff, 3 attempts) stored in `metadata`.

## 11) HITL Approvals
- Use existing Telegram `sendAndWait` node for approvals/clarifications on blocking steps (see docs/hitl.txt). On approval, append event and store a short episodic memory.

## 12) Observability & Metrics
- `run_events` is the ground truth audit trail; expose a list/read endpoint via MCP.
- Basic counters: tasks created/claimed/completed, average handoff latency, failure rates.
- Tie into existing `/metrics` patterns in docs (tool call durations, memory search).

## 13) Security & Guardrails
- Persona‑scoped tool allowlists (from `personas.capabilities`) enforced in prompt and by MCP server.
- Redact secrets from `run_events` and RAG memories; store references instead of raw tokens/URLs where possible.
- Optional: per‑persona output schema validation before `handoff.complete`.

## 14) Rollout Plan
1. Add Drizzle models + migrations for the three tables.
2. Implement MCP tools (`run_state`, `handoff`, `run_events` wrappers).
3. Patch `agent.workflow.json`: add state bootstrap node, inject system prompt, wire `runId` to all tools, replace `Switch` with SQL‑driven routing.
4. Update memory store to auto‑fill metadata `{runId, persona, project}` when present.
5. E2E dry run: chat → writer → editor → uploader; verify SQL + memories + Telegram.
6. Gradually enable for more personas/projects.

## 15) Testing Strategy
- Unit: MCP tool handlers; lease logic; schema validators.
- Integration: handoff create/claim/complete across two personas; memory retrieval by `runId`.
- E2E: scripts in repo (e.g., `test-full-mcp-flow.sh`) extended to assert SQL + RAG side effects.

## 16) Risks & Mitigations
- Risk: double work due to race conditions → leases + idempotent `handoff.complete`.
- Risk: prompt drift across personas → single prompt template source with version pin.
- Risk: context bloat → memory summaries capped and auto‑summarized per existing pipeline.

## 17) Success Metrics
- ≥95% handoffs without manual intervention.
- <5s median handoff latency (task create → claim).
- 0 hallucinated IDs; 100% of tool calls carry canonical `runId`.
- Retrieval precision: >0.8 for `memory.searchByRun` evaluated on sampled runs.

## 18) Open Questions
- Do we need per‑project step enums to standardize `current_step`?
- Should we auto‑page on stalled handoffs (no claim within TTL)?
- Where to surface run timeline UI (n8n dashboard vs. separate viewer)?

---

Appendix A — Example Memory Entry
```json
{
  "content": "Editor selected take #3; trimmed to 45s.",
  "memoryType": "episodic",
  "project": ["aismr"],
  "persona": ["editor"],
  "tags": ["handoff", "edit"],
  "metadata": { "runId": "<uuid>", "handoffId": "<uuid>" }
}
```

Appendix B — Prompt Snippet (system)
```
You are an orchestrating agent following a strict protocol.
- Always read run state via run_state.read(runId) before acting.
- Log significant actions to run_events and store a brief episodic memory with metadata.runId.
- For delegation, create a handoff task then invoke the target persona workflow with the canonical runId.
- Never invent IDs.
```

Appendix C — n8n Notes
- Ensure all tool nodes accept `runId` from the bootstrap node; remove `$fromAI('runId', …)`.
- Replace blank `Switch` with SQL‑backed decision (pending tasks, blocked runs, or completion).
- Keep existing MCP Client and tool workflows; we’re adding a thin state layer, not replacing tools.
