## Alignment Plan (GPT-5) — Code Review to North Star

Date: 2025-11-09
Owner: GPT-5
Scope: Full repo review vs NORTH_STAR V2 (trace-driven, one workflow, memory-first)

---

### Executive Summary

The codebase is strongly aligned with the North Star. The core tenets are implemented and in good shape:
- One polymorphic workflow in n8n that personifies any agent from `trace.currentOwner`
- Trace as the state machine (`execution_traces` with `currentOwner`, `workflowStep`, `status`)
- Projects define workflows and guardrails
- Agents call minimal tools (`memory_search`, `memory_store`, `handoff_to_agent`; plus `trace_update` for Casey, and `workflow_trigger`/`jobs` for production personas)
- Terminal handoffs (`complete`/`error`) update the trace and (for completion) send user notifications

What remains: a handful of naming/documentation deltas, a minor hardening for direct tool calls, and a few small DX/ops polish tasks. These are not architectural blockers and can be addressed quickly to reach a crisp V2.

---

### Alignment Scorecard

- One Workflow for All Personas: Aligned
  - Evidence: `workflows/myloware-agent.workflow.json` (single AI Agent + MCP tools; tool guardrails applied within workflow)

- Trace as State Machine: Aligned
  - Evidence: `src/db/schema.ts` includes `currentOwner`, `workflowStep`, `status`, `completedAt`, etc.

- Projects Define Workflows/Guardrails: Aligned
  - Evidence: `projects` table schema; runtime playbooks merged into prompts (guardrails, expectations, workflow).

- Handoff Updates Trace + Invokes Same Webhook: Aligned
  - Evidence: `handoff_to_agent` updates trace atomically and posts to universal webhook; handles terminal targets.

- Memory-First Coordination: Aligned
  - Evidence: `memory_search`/`memory_store` with `traceId` column, vector+keyword hybrid, temporal metrics.

- Minimal Tool Access by Persona: Aligned
  - Evidence: dynamic `allowedTools` calculation; workflow-side guardrails filter Telegram-only tools.

---

### Key Code References (evidence)

```246:299:src/mcp/tools.ts
const tracePrepareTool: MCPTool = {
  name: 'trace_prepare',
  title: 'Prepare Trace Context',
  ...
  const responsePayload = await prepareTraceContext(tracePrepParams);
  return { ...structuredContent: responsePayload };
}
```

```245:297:src/db/schema.ts
export const executionTraces = pgTable(
  'execution_traces',
  {
    traceId: uuid('trace_id').notNull().unique(),
    currentOwner: text('current_owner').notNull().default('casey'),
    previousOwner: text('previous_owner'),
    instructions: text('instructions').notNull().default(''),
    workflowStep: integer('workflow_step').notNull().default(0),
    status: traceStatusEnum('status').notNull().default('active'),
    completedAt: timestamp('completed_at'),
    ...
  },
  ...
);
```

```429:771:src/mcp/tools.ts
const handoffToAgentTool: MCPTool = {
  name: 'handoff_to_agent',
  ...
  if (isTerminalTarget) { /* sets status completed/failed, notifies on completion */ }
  ...
  const webhookUrl = `${config.n8n.webhookUrl}/webhook/myloware/ingest`;
  /* optimistic locking; memory log; webhook invocation */
}
```

```580:801:src/utils/trace-prep.ts
export async function prepareTraceContext(...) {
  /* merges project playbooks (guardrails/workflow/expectations), loads memories,
     builds persona prompt, derives allowedTools */
  return { systemPrompt, allowedTools, trace, ... };
}
```

```36:55:src/tools/memory/searchTool.ts
if (params.traceId) {
  const traceScoped = await repository.findByTraceId(params.traceId, { ... });
  return { memories: traceScoped, ... };
}
```

```248:273:src/db/repositories/memory-repository.ts
async findByTraceId(traceId: string, ...) {
  const conditions = [eq(memories.traceId, traceId)];
  ...
  return db.select().from(memories).where(where).orderBy(desc(memories.createdAt))...
}
```

```449:456:src/server.ts
// HTTP endpoint for universal workflow preprocessing
fastify.post('/mcp/trace_prep', async (request, reply) => { await handleTracePrep(request, reply); });
```

---

### Identified Deltas (Minor Gaps)

1) Naming consistency: `trace_prepare` (MCP tool) vs `trace_prep` (HTTP endpoint) vs docs
- Impact: Small DX friction; new contributors may be confused by dual naming.
- Options:
  - A) Keep as-is (tool = `trace_prepare`, HTTP = `trace_prep`) and update docs to state both explicitly.
  - B) Rename MCP tool to `trace_prep` for symmetry. This is a breaking change in tool name.
- Recommendation: Option A (docs update) now; revisit rename only if it keeps causing confusion.

2) Direct tool call endpoint persona hardening
- Current: `POST /tools/:toolName` executes tool handlers directly for n8n integration with API key auth.
- Risk: If the API key leaked, callers could invoke persona-restricted tools directly (still not catastrophic, but avoidable).
- Recommendation: Require `traceId` + server-side persona gating for sensitive tools (e.g., `workflow_trigger`, `jobs`), validating against current `trace.currentOwner` and `deriveAllowedTools`. n8n already includes `callerPersona` in tool workflows; tighten backend checks to match.

3) Docs clarity and cross-linking
- Minor mismatches across the docs (tool naming; where guardrails come from). The code correctly loads project playbooks and merges guardrails/expectations; ensure docs consistently point to that flow.

4) Test supplements (nice-to-have)
- Add an integration test that exercises terminal handoff (`toAgent: 'complete'`) and verifies Telegram completion messaging path toggles correctly based on `sessionId` prefix.
- Add a small unit around `deriveAllowedTools` to fix persona-to-tool expectations as “contract tests” (prevents accidental widening).

---

### Prioritized Action Plan (1–3 days)

P0 — Ship now (no breaking changes)
- A1. Update docs to standardize naming and flow
  - Update references to clarify: MCP tool is `trace_prepare`; HTTP workflow endpoint is `/mcp/trace_prep`.
  - Note where playbooks load and how guardrails/expectations appear in prompts.
  - Files: `docs/02-architecture/system-overview.md`, `docs/02-architecture/universal-workflow.md`, `docs/06-reference/mcp-tools.md`.

- A2. Harden direct tool execution path
  - In `POST /tools/:toolName`:
    - If `toolName` ∈ {`workflow_trigger`, `jobs`} then:
      - Require `traceId` in body.
      - Fetch trace, compute `allowedTools` from `deriveAllowedTools` using `trace.currentOwner`.
      - Reject if tool not permitted for current persona.
  - Minimal changes; preserves n8n behavior (workflows already pass context fields).

- A3. Add two focused tests
  - T1: Terminal handoff → `complete` → Telegram notify conditional on `sessionId` prefix; ensure safe behavior when no URL present.
  - T2: `deriveAllowedTools` persona surface (Casey only gets `trace_update`; Veo/Alex get `workflow_trigger` + `jobs`; Quinn gets `workflow_trigger`; others core only).

P1 — Optional polish (non-blocking)
- A4. Consider aligning tool name to `trace_prep` across MCP and HTTP for symmetry (breaking change; defer).
- A5. Add a brief “Tool Security” section to `docs/05-operations/security-hardening.md` describing API key management, least-privilege tool exposure, and why `/tools` path is locked down.

---

### Acceptance Criteria

- Documentation
  - Docs clearly describe `trace_prepare` vs `/mcp/trace_prep`, where prompts/tools come from, and how playbooks populate guardrails/expectations.

- Security
  - `/tools/:toolName` rejects persona-restricted tools when `traceId` is missing or when the active persona doesn’t permit the tool.
  - No behavioral regressions for existing n8n workflows.

- Tests
  - Terminal handoff integration test passes.
  - `deriveAllowedTools` contract tests pass.

---

### Risk/Impact

- Low risk; changes are additive and primarily defensive/documentational.
- Hardening `/tools` reduces blast radius if an API key is compromised.
- Docs updates reduce onboarding friction and tighten mental model around preprocessing vs tool execution.

---

### Notes on Current Strengths

- Universal workflow file is clean and follows the 3-node pattern (Prepare → Agent → Handoff). Tools list is dynamically scoped and Telegram tools are filtered unless the session is Telegram.
- The `trace_prepare`/`/mcp/trace_prep` pipeline is robust: playbooks are loaded from the project directory, memories are summarized for prompts, and tools are minimally scoped per persona.
- `handoff_to_agent` implements optimistic locking and terminal-state handling with Telegram notifications, matching the North Star’s “completion is terminal” principle without polling.

---

### Quick Wins (If time allows)

- Add a small “developer map” at the top of `NORTH_STAR.md` linking directly to the four most relevant code entry points:
  - `src/api/routes/trace-prep.ts` (HTTP preprocess entry)
  - `src/utils/trace-prep.ts` (prompt + tools assembly)
  - `src/mcp/tools.ts` (persona-facing tools)
  - `workflows/myloware-agent.workflow.json` (n8n universal workflow)

---

### Closing

The architecture is on-target and production-friendly. Address the short list of deltas (naming clarity, minor persona gating on direct tool calls, a couple of targeted tests, and doc updates) and we will have a crisp, fully aligned North Star V2.

