# Agent Development Guide

Quick reference for AI and human agents working in the `mcp-prompts` repository.

---

## Mission

Build a **multi-agent, memory-first AI Production Studio** where:

- Casey (Showrunner) coordinates production runs via `traceId`
- Specialist agents (Iggy, Riley, Veo, Alex, Quinn) work autonomously
- Memory tagged by `traceId` provides coordination fabric
- Each agent hands off directly to the next via natural language

**Current Status (Nov 7, 2025):** Epic 1 (trace coordination) is live. Epic 2 (agent workflows) is next.

## Persona Workflow Overview (North Star Alignment)

The North Star pipeline runs strictly in this order: Casey → Iggy → Riley → Veo → Alex → Quinn. All personas execute in the **same universal workflow** (`myloware-agent.workflow.json`), which becomes any persona dynamically based on `trace.currentOwner`.

| Agent | Entry Trigger | Core Responsibilities | Required MCP Tools |
| ----- | ------------- | --------------------- | ------------------ |
| Casey (Showrunner) | User request via Telegram/Chat (no traceId) | Determine project, set projectId, create kickoff memory, hand off to Iggy | `trace_update` (via `set_project`), `memory_store`, `handoff_to_agent` |
| Iggy (Creative Director) | Webhook with traceId (Casey's handoff) | Generate 12 AISMR modifiers, log to memory, seek HITL approval, pass to Riley | `memory_search`, `memory_store`, `handoff_to_agent` |
| Riley (Head Writer) | Webhook with traceId (Iggy's handoff) | Retrieve modifiers, draft scripts, store outputs, hand off to Veo | `memory_search`, `memory_store`, `handoff_to_agent` |
| Veo (Production) | Webhook with traceId (Riley's handoff) | Convert scripts to video assets via toolWorkflow, track jobs, store URLs, hand off to Alex | `memory_search`, `memory_store`, `job_upsert`, `jobs_summary`, `handoff_to_agent` |
| Alex (Editor) | Webhook with traceId (Veo's handoff) | Stitch edits via toolWorkflow, request HITL approval, store final edit, hand off to Quinn | `memory_search`, `memory_store`, `job_upsert`, `jobs_summary`, `handoff_to_agent` |
| Quinn (Publisher) | Webhook with traceId (Alex's handoff) | Publish final edit, store platform URLs, call `handoff_to_agent({ toAgent: 'complete' })` | `memory_search`, `memory_store`, `handoff_to_agent` |

**Universal Workflow Pattern:**
1. Trigger (Telegram/Chat/Webhook) → Edit Fields → trace_prep HTTP Request → AI Agent Node
2. trace_prep discovers persona from `trace.currentOwner` and returns `systemPrompt` + `allowedTools`
3. AI Agent executes as that persona with scoped tools
4. Agent calls `handoff_to_agent`, which invokes same workflow via webhook with `{ traceId }`
5. Loop repeats: trace_prep discovers next persona, workflow becomes that persona

Casey's job is to start the run; Quinn signals completion via `handoff_to_agent({ toAgent: 'complete' })`, which sends user notification. Every handoff must include the active `traceId` so memories remain queryable by downstream personas.

### Build Order Snapshot (Nov 7, 2025)

1. **Epic 1 DoD close-out:** lock the ≥50% interim coverage floor, legacy tool guardrails, and rollback checklist.
2. **Story 2.1 (Casey → Iggy):** ship Casey’s workflow JSON plus prompt/docs before any downstream persona work.
3. **Story 2.2 (Iggy → Riley):** once Casey is live, focus on Iggy’s HITL-aware workflow, memory discipline, and the Iggy→Riley integration test stub.
4. **Stories 2.3–2.6:** proceed sequentially only after the prior persona’s workflow and documentation are merged.

Staying in this order keeps `plan.md` and AGENTS instructions aligned with the North Star runbook.

### Workflow Assets (Phase 2)

- `workflows/myloware-agent.workflow.json` — **Universal workflow** that becomes any persona dynamically. Structure:
  - **Triggers:** Telegram, Chat, Webhook (all feed into same workflow)
  - **Edit Fields Node:** Normalizes inputs, extracts `traceId` from webhook body
  - **trace_prep HTTP Request:** Calls `POST /mcp/trace_prep` with normalized inputs
  - **AI Agent Node:** Receives `systemPrompt` and `allowedTools` from trace_prep response
  - **MCP Client:** Filters tools by `allowedTools` from trace_prep (dynamic scoping)
  - **Handoff Loop:** Agent calls `handoff_to_agent`, which invokes same workflow via webhook

- **Important:** n8n Cloud does **not** support `$env.*` placeholders inside workflow JSON. Hard-code URLs:
  - trace_prep URL: `https://mcp-vector.mjames.dev/mcp/trace_prep`
  - MCP Client URL: `https://mcp-vector.mjames.dev/mcp`
  - MCP Client includeTools: `={{ $('Prepare Trace Context').item.json.allowedTools }}` (dynamic)

---

## Repository Structure

| Path                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `src/mcp/tools.ts`     | All MCP tools (trace, memory, workflow)      |
| `src/db/schema.ts`     | Postgres schema (source of truth)            |
| `src/db/repositories/` | Drizzle repositories with unit tests         |
| `docs/`                | Canonical documentation                      |
| `plan.md`              | Implementation roadmap (work in story order) |
| `tests/`               | Vitest suites (unit, integration, e2e)       |
| `NORTH_STAR.md`        | Vision: detailed multi-agent walkthrough     |

---

## Development Workflow

### Prerequisites

- Node 18+ (tested on 20/22)
- Docker (Colima or Docker Desktop) for test harness
- `npm install` at repo root

### Environment Setup

1. **Copy environment file:**

   ```bash
   cp .env.example .env
   ```

2. **Set required variables:**

   ```bash
   OPENAI_API_KEY=sk-...
   MCP_AUTH_KEY=your-auth-key
   DB_PASSWORD=secure-password
   N8N_BASE_URL=https://n8n.yourdomain.com
   N8N_API_KEY=your-n8n-key
   ```

3. **Bootstrap database (if using Docker stack):**
   ```bash
   npm run db:bootstrap -- --seed
   ```

### Running Locally

```bash
# Hot reload (host machine)
npm run dev

# Full Docker stack (postgres + n8n + MCP server)
npm run dev:docker

# Stop Docker stack
npm run dev:stop
```

**Access Points:**

- MCP Server: `http://localhost:3456`
- Health Check: `http://localhost:3456/health`
- n8n UI: `http://localhost:5678`

---

## Testing

### Quick Start

```bash
# All unit tests (disposable Postgres container)
TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit

# Specific test file
npx vitest run tests/unit/mcp/trace-tools.test.ts

# Integration tests
TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/integration

# Coverage report
npm run test:coverage
```

> **Coverage Baseline (Nov 7, 2025):** `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit --coverage` exercises 25 files / 152 tests and currently reports 66.70% lines (interim target ≥50% while we prep the uplift back to 80%). CI now runs the same containerized unit-test command so raise coverage before merging.

### Test Harness

**How it works:**

1. `tests/setup/database.ts` starts `pgvector/pgvector:pg16`
2. Auto-discovers Docker socket (Colima/Docker Desktop)
3. Runs migrations via `drizzle-kit push`
4. Seeds base data
5. Resets Drizzle client to point at ephemeral DB
6. Tears down container after tests finish

**Benefits:**

- No port conflicts between developers
- Schema/seed data always in sync
- Works in CI and locally
- Self-contained test environment

**Alternative (local DB):**
Export `TEST_DB_URL` and run `npm run test:unit:local` (see `DEV_GUIDE.md`)

---

## Documentation Standards

### Where Documentation Lives

**`docs/` directory** is the single source of truth:

- Architecture, integration guides, tool references
- Task-focused Markdown files (not monoliths)
- Keep fresh—stale docs degrade agents quickly

**Special Files:**

- `plan.md` - Implementation roadmap (drives execution order)
- `NORTH_STAR.md` - Vision (detailed multi-agent walkthrough, do not edit)
- `AGENTS.md` - This file (quick reference for agents)
- `docs/MCP_PROMPT_NOTES.md` - Canonical system prompts + tool sequences per persona

### Documentation Rules

1. **Docs vs Plan:**
   - `plan.md` = what to build and in what order
   - `docs/` = how things work and integrate

2. **Update Both:**
   When scope or design shifts, update both `plan.md` and relevant `docs/` files

3. **Prefer Context7 Docs:**
   When responding via Context7 (OpenAI doc retrieval), prioritize `docs/` content

### Prompt Notes

Reference `docs/MCP_PROMPT_NOTES.md` for:

- The global system prompt block every persona inherits (trace-first contract)
- Agent-specific instructions covering required MCP tool calls
- Example JSON payloads for `trace_create`, `handoff_to_agent`, `memory_store`, and `workflow_complete`
- n8n workflow template checklist (trigger inputs, MCP tools to mount, HITL guidance)
- Paging guidance for `memory_search` (use `traceId` + `offset` to walk long traces)

Always update both this file and the prompt notes when prompt behavior changes.

### MCP Clients

- **Context7 Doc Retrieval**  
  Use the Context7 MCP server before changing code: fetch official `docs/` content (or other repo files) so you are working from the latest source of truth. Pull persona/system prompts, architecture details, and workflows via Context7, then implement. This keeps prompts and tooling synchronized with documentation and fulfills the “prefer Context7 docs” rule above.

- **`mylo_mcp` Tool Server**  
  The local MCP server (auth header `X-API-Key: mylo-mcp-bot`) exposes the live tool set plus hot-reload dev server running at `http://localhost:3456` (`CURSOR_MCP_SETUP.md`). Use it to exercise tools (`tools/list`, `tools/call`) and to validate changes end-to-end through Cursor, Claude Desktop, or CLI clients. Restart via `docker compose --profile dev restart mcp-server-dev` if the tools list looks stale, and always confirm `/health` before debugging agent flows.
---

## Key Tools & Patterns

### Universal Workflow Pattern

All personas execute in the same workflow (`myloware-agent.workflow.json`). The workflow pattern:

```typescript
// 1. Workflow receives trigger (Telegram/Chat/Webhook)
// 2. Edit Fields normalizes inputs
// 3. trace_prep HTTP Request (POST /mcp/trace_prep)
const prep = await fetch('/mcp/trace_prep', {
  method: 'POST',
  body: JSON.stringify({ traceId, sessionId, instructions, source })
});
// Returns: { systemPrompt, allowedTools, traceId, instructions, memorySummary }

// 4. AI Agent Node receives prep response
//    - System Prompt: prep.systemPrompt
//    - Allowed Tools: prep.allowedTools (dynamically scoped)
//    - User Message: prep.instructions

// 5. Agent executes as persona (Casey/Iggy/Riley/Veo/Alex/Quinn)
// 6. Agent calls handoff_to_agent, which invokes same workflow via webhook
```

### Trace Coordination (Epic 1)

```typescript
// trace_prep creates trace automatically (when no traceId provided)
// Returns traceId in response

// Casey determines project and sets it
await set_project({
  traceId: 'trace-aismr-001',
  projectId: 'aismr'
});

// Casey hands off to Iggy
await handoff_to_agent({
  traceId: 'trace-aismr-001',
  toAgent: 'iggy',
  instructions: 'Generate 12 candle modifiers. Validate uniqueness.'
});
// Updates trace: currentOwner = "iggy", workflowStep = 1
// Invokes webhook: POST /webhook/myloware/ingest { traceId }

// Iggy stores work (tagged with traceId)
await memory_store({
  content: 'Generated 12 modifiers: Void, Liquid...',
  memoryType: 'episodic',
  project: ['aismr'],
  persona: ['iggy'],
  metadata: { traceId: 'trace-aismr-001', modifiers: [...] }  // KEY: Tag with traceId
});

// Quinn signals completion
await handoff_to_agent({
  traceId: 'trace-aismr-001',
  toAgent: 'complete',
  instructions: 'Published AISMR candles compilation to TikTok successfully. URL: https://tiktok.com/...'
});
// Sets trace status = "completed", sends Telegram notification to user
```

### Memory Discipline

**Always tag memories with:**

- `traceId` (for coordination)
- `persona` (who created it)
- `project` (which project it belongs to)

**Example:**

```typescript
await memory_store({
  content: 'User approved 12 candle modifiers',
  memoryType: 'episodic',
  project: ['aismr'],
  persona: ['iggy'],
  tags: ['approval', 'candles'],
  metadata: { traceId: 'trace-aismr-001' },
});
```

### n8n Integration

- **Universal workflow:** Single workflow (`myloware-agent.workflow.json`) handles all personas
- **Handoff triggers:** `handoff_to_agent` invokes same workflow via webhook (`POST /webhook/myloware/ingest`)
- **Webhook URL:** Hard-coded in `handoff_to_agent` tool: `${config.n8n.webhookUrl}/webhook/myloware/ingest`
- **HITL nodes:** Telegram "Send and Wait" for human approval (configured in workflow, not prompts)
- **Secrets:** Stay in env vars, never hard-coded in workflow JSON

### Removed Tools (Nov 7, 2025)

**Do not reference these in new work:**

- `clarify_ask` - Use Telegram HITL nodes in n8n workflows
- `prompt_discover` - Use procedural memories + `memory_search`
- Any `run_state_*` / `handoff_*` legacy endpoints — the stack is now `trace_create` → `handoff_to_agent` → `workflow_complete`. Run `npm run check:legacy-tools` (also enforced via the CI “Legacy Tool Guard” job) before pushing to ensure the forbidden symbols stay gone. The legacy orchestrator now lives in `workflows/archive/agent.workflow.json`, and the guard scans every active workflow JSON.

---

## Handoff Checklist

Before marking a story "done":

1. ✅ Update `plan.md` checkboxes for the story
2. ✅ Update/create docs in `docs/` reflecting new behavior
3. ✅ Run full test suite and verify it passes:
   ```bash
   TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit
   ```
4. ✅ Paste or summarize test results in your handoff note
5. ✅ Document follow-on work (bugs, docs debt, next prerequisites)
6. ✅ If migrations or seeds changed, run `npm run db:test:rollback` and record the success summary (the PR template now enforces this reminder).

---

## Coverage Requirements

- **Unit tests:** ≥50% coverage (temporary floor; plan to raise back to 80% after stability work)
- **All MCP tools:** Must have targeted unit tests
- **Repositories:** Must have tests for CRUD operations
- **Integration:** At least one happy path test per epic
- Containerized unit tests now enforce the ≥50% coverage floor automatically. Run `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit` (or set `VITEST_COVERAGE=true`) locally to mirror CI.

**Current Status:** 154 tests / 26 files (as of Nov 7, 2025)

---

## Common Commands

```bash
# Development
npm run dev                  # Hot reload (local)
npm run dev:docker          # Full stack with hot reload
npm run dev:stop            # Stop Docker stack

# Testing
npm test                    # All tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:coverage       # Coverage report

# Database
npm run db:reset           # Wipe and recreate
npm run db:migrate         # Run migrations
npm run db:seed            # Load seed data
npm run db:bootstrap       # All of the above
npm run db:test:rollback   # Spin up ephemeral pgvector, migrate, drop schema, re-migrate (rollback safety)

# Code Quality
npm run type-check         # TypeScript validation
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix linting issues
npm run format             # Prettier format
npm run format:check       # Check formatting
npm run check:legacy-tools # Scan for forbidden legacy tool names
```

---

## Critical Development Rules

1. **Always pull main** before creating a new branch
2. **Follow red-green-refactor** for acceptance criteria
3. **Never skip husky hooks** (no `--no-verify`)
4. **Never commit without tests passing**
5. **Only commit when explicitly asked** (don't be proactive)
6. **Never force push to main/master**

---

## The North Star Vision

Read `NORTH_STAR.md` for the complete vision:

**Key Agents:**

- **Casey** - Showrunner (coordinates, doesn't orchestrate)
- **Iggy** - Creative Director (generates ideas)
- **Riley** - Head Writer (writes screenplays)
- **Veo** - Production (generates videos)
- **Alex** - Editor (stitches compilations)
- **Quinn** - Social Media Manager (publishes)

**Key Principle:** Agents call agents autonomously. Casey kicks off, agents hand off directly to each other, Casey waits for completion signal.

---

## Questions?

- **Architecture:** Read `docs/ARCHITECTURE.md`
- **MCP Tools:** Read `docs/MCP_TOOLS.md`
- **Testing:** Read `DEV_GUIDE.md`
- **Deployment:** Read `docs/DEPLOYMENT.md`
- **Vision:** Read `NORTH_STAR.md`

Stay trace-aware. Keep memory clean. Document as you go.
