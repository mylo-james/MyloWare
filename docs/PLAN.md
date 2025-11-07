# Implementation Plan: North Star V2 Universal Workflow

**Last Updated:** November 7, 2025  
**Status:** 🚧 In Progress  
**Architecture:** Single Universal Workflow + Trace State Machine  
**Target:** North Star V2 - Self-discovering agent system  
**Current Blocker:** None - Epic 1 complete, Epic 2 in progress

---

## 🎯 Vision & Architectural Decisions

### Core Principles

- ✅ **Trace as single source of truth** - ownership, workflow position, instructions, completion state
- ✅ **One polymorphic n8n workflow** - becomes any persona by querying trace + configuration
- ✅ **State transitions via handoffs** - `handoff_to_agent` tagged with `traceId`, special `complete`/`error` terminals
- ✅ **Declarative personas/projects** - configuration drives instructions; agents remain stateless
- ✅ **Memory discipline** - always tag `traceId`, `project`, `persona`
- ✅ **Official doc alignment** - keep implementations consistent with n8n 1.x, OpenAI Responses API, Shotstack Serve API, and Model Context Protocol guidance

### Key Architectural Decisions

1. ✅ **trace_prep HTTP endpoint** - Server-side preprocessing assembles complete prompt
2. ✅ **Agents call handoff_to_agent tool** - AI nodes own their handoffs
3. ✅ **Quinn notifies user directly** - No Casey blocking loop needed
4. ✅ **AI agents call toolWorkflow for async ops** - toolWorkflow handles Wait nodes internally
5. ✅ **workflow (singular) array** - One ordered pipeline per project
6. ✅ **Server-side discovery** - trace_prep endpoint does all context assembly
7. ✅ **External integrations validated** - follow OpenAI Responses payload schema, Shotstack job lifecycle, and MCP server/client setup requirements

---

## 📊 Current State Assessment

### ✅ Completed (Epic 1 Foundation)

- [x] Trace schema updated with ownership fields (`0005_add_owner_workflow.sql`)
  - `currentOwner`, `instructions`, `workflowStep`, `previousOwner` exist
- [x] Legacy tables removed (`0006_drop_legacy_orchestration.sql`, `0007_drop_workflow_registry.sql`)
  - `agent_runs`, `handoff_tasks`, `run_events`, `workflow_registry` dropped
- [x] Job ledger implemented (`0008_job_ledger.sql`)
  - `video_generation_jobs` and `edit_jobs` tables exist
  - Repositories: `video-jobs-repository.ts`, `edit-jobs-repository.ts`
  - Unit tests: `edit-jobs-repository.test.ts`, `video-jobs-repository.test.ts`
- [x] MCP tools partially implemented
  - `trace_create`, `trace_update`, `handoff_to_agent` exist
  - `trace_prepare` exists (MCP tool, not HTTP endpoint)
  - `memory_store`, `memory_search` exist
  - Job tools exist with unit tests
- [x] Workflow skeleton exists (`myloware-agent.workflow.json`)
  - 3 triggers: Telegram, Chat, Webhook
  - Edit Fields → trace_prep → AI Agent structure

### ✅ Epic 1 Complete (Foundation)

- [x] **trace_prep HTTP endpoint** - Implemented in `src/api/routes/trace-prep.ts`
  - Wraps `trace_prepare` MCP tool logic
  - Handles trace creation/loading, persona discovery, project context, memory retrieval
  - Returns systemPrompt, allowedTools, traceId, instructions
- [x] **Persona schema** - Added `allowedTools` array field (`0009_persona_allowed_tools.sql`)
  - All personas seeded with allowedTools configuration
  - Repository updated to handle allowedTools
- [x] **Project schema** - Updated to singular `workflow` + `optionalSteps` (`0010_project_workflow_singular.sql`)
  - Migrated from plural `workflows` to singular `workflow`
  - Added `optionalSteps` array for optional workflow steps
- [x] **Workflow configuration** - `myloware-agent.workflow.json` fully configured
  - Edit Fields node normalizes inputs from all triggers
  - trace_prep HTTP Request node configured with correct URL and auth
  - AI Agent node receives dynamic systemPrompt and instructions
  - MCP Client node filters tools by allowedTools
  - All tool nodes have descriptions and notes
- [x] **Optimistic locking** - Implemented in `trace-repository.ts` with retry logic
- [x] **Transaction support** - handoff_to_agent wrapped in transactions for atomicity
- [x] **Shared trace_prepare logic** - Extracted to `src/utils/trace-prep.ts`

### ✅ Epic 2 In Progress

- [x] **Story 2.1** - trace_prep HTTP Request Node configured and tested
  - ✅ Edit Fields normalizes inputs (traceId, sessionId, message, source)
  - ✅ trace_prep HTTP Request node configured
  - ✅ Tested: Telegram trigger creates new trace
  - ✅ Tested: Webhook trigger loads existing trace
- [x] **Story 2.2** - AI Agent Node configured with dynamic tools
  - ✅ AI Agent receives systemPrompt from trace_prep
  - ✅ MCP Client filters tools by allowedTools
  - ✅ Tested: Casey loads correctly and hands off to Iggy
  - ✅ Tested: Iggy loads correctly
- [x] **Story 2.4** - Race conditions and concurrency fixed
  - ✅ Optimistic locking implemented
  - ✅ Concurrent handoff tests pass
  - ✅ Transaction support added

### ⚠️ Remaining Verification (Epic 2)

- [x] **Story 2.2** - Tool filtering verified ✅
  - [x] Database updated: Casey has `trace_update`, Iggy does not ✅
  - [x] All personas have correct `allowed_tools` configured ✅
- [ ] **Story 2.3** - Test complete handoff chain
  - [ ] Test: Casey → Iggy → Riley → Veo → Alex → Quinn chain
  - [ ] Verify self-referential loop works (same workflow, different personas)
  - [ ] Test special handoff targets: "complete" and "error"
  - [ ] Add safety timeout: auto-handoff to "error" if agent doesn't handoff

---

## 🗺️ Epic Roadmap

### Critical Path

```
Epic 1 (Server-Side Preprocessing) ← MUST DO FIRST
  └── Story 1.1: trace_prep endpoint (BLOCKER FOR ALL ELSE)
  └── Story 1.2: Persona schema
  └── Story 1.3: Project schema

Epic 2 (Complete Workflow) ← THEN THIS
  └── Depends on Epic 1 completion

Epic 3-6 (Can run in parallel after Epic 2)
```

### Progress Summary

- **Total Epics:** 6
- **Total Stories:** 15
- **Completed:** 0 stories (foundation in place)
- **In Progress:** Epic 1 prep
- **Blocked:** Epic 2-6 (blocked by Epic 1)

---

## 📋 Epic 1: Server-Side Preprocessing (CRITICAL PATH)

**Duration:** 2-3 days  
**Status:** ✅ COMPLETED  
**Blockers:** None  
**Goal:** Implement trace_prep HTTP endpoint that does ALL preprocessing

### Story 1.1: Create trace_prep HTTP Endpoint ⭐ CRITICAL ✅ COMPLETED

**Why:** Heart of universal workflow pattern - workflows discover persona at runtime  
**Current State:** ✅ HTTP endpoint implemented at `POST /mcp/trace_prep`  
**Decision:** ✅ Chose Option A (HTTP wrapper) - implemented and tested  
**Acceptance Criteria:** ✅ HTTP endpoint exists, creates/loads traces, returns complete systemPrompt

#### Architecture Decision

**Option A: HTTP Endpoint Wrapper (Recommended)**

- Create `POST /mcp/trace_prep` endpoint that wraps `trace_prepare` MCP tool logic
- Workflow uses HTTP Request node (simpler, matches current workflow structure)
- Reuse existing `trace_prepare` handler code

**Option B: Refactor Workflow**

- Use MCP Client node to call `trace_prepare` tool directly
- Requires workflow restructure (MCP Client before AI Agent)
- More complex but avoids duplicate code

**Recommendation:** Option A - Build HTTP endpoint wrapper for simplicity and workflow compatibility.

#### Tasks

- [x] **Decision:** Choose Option A (HTTP wrapper) or Option B (workflow refactor)
  - [x] If Option A: Create HTTP endpoint wrapper ✅
  - [ ] If Option B: Update workflow to use MCP Client for trace_prepare (not needed)

- [x] Create HTTP endpoint infrastructure (if Option A)
  - [x] Create `src/api/routes/trace-prep.ts` ✅
  - [x] Mount route in `src/server.ts` (add `POST /mcp/trace_prep`) ✅
  - [x] Configure authentication (reuse `authenticateRequest` from server.ts) ✅
  - [x] Match request/response format expected by workflow ✅

- [x] Implement endpoint logic (reuse from trace_prepare tool)
  - [x] Extract logic from `trace_prepare` handler (lines 550-661 in tools.ts) ✅
  - [x] Get or create trace based on `traceId` presence ✅
  - [x] Default new traces to Casey + "unknown" project ✅
  - [x] Load persona config from database ✅
  - [x] Build system prompt (special Casey init vs standard agent) ✅
  - [x] Load memories filtered by traceId ✅
  - [x] Return assembled payload: `{ traceId, systemPrompt, allowedTools, instructions, memories }` ✅

- [x] Create helper functions (if needed)
  - [x] `buildCaseyInitPrompt(persona, trace)` - Special prompt for unknown project ✅
  - [x] `buildAgentPrompt(persona, project, trace, memories)` - Standard agent prompt ✅
  - [x] `stripEmbedding(memory)` - Remove vector data from memory payloads ✅
  - [x] Follow North Star templates (lines 212-227, 327-346) ✅

- [x] Add unit tests (`tests/unit/api/trace-prep.test.ts`)
  - [x] Test new trace creation (no traceId provided) ✅
  - [x] Test existing trace load (traceId provided) ✅
  - [x] Test Casey init prompt (projectId = 'unknown') ✅
  - [x] Test standard agent prompt (projectId known) ✅
  - [x] Test persona not found error ✅
  - [x] Test project not found error ✅
  - [x] Test memory search integration ✅

- [x] Add integration test (`tests/integration/trace-prep-endpoint.test.ts`)
  - [x] Full flow: create trace → load → update → reload ✅
  - [x] Verify prompt assembly with real data ✅
  - [x] Verify memory integration ✅

- [x] Verify coverage
  - [x] Run `TEST_DB_USE_CONTAINER=1 npx vitest run tests/unit` ✅
  - [x] Ensure ≥50% coverage maintained ✅ (89% coverage for trace-prep.ts)
  - [x] All tests pass ✅ (15/15 tests passing)

**Definition of Done:**

- [x] `POST /mcp/trace_prep` endpoint responds to requests ✅
- [x] Creates trace when no traceId (defaults: casey, unknown project) ✅
- [x] Loads trace when traceId provided ✅
- [x] Returns complete systemPrompt based on persona + project ✅
- [x] Returns allowedTools from persona config ✅
- [x] Returns memories filtered by traceId ✅
- [x] Unit tests pass (≥50% coverage) ✅ (89% coverage)
- [x] Integration test passes ✅

**Implementation Summary:**

- ✅ Created `src/api/routes/trace-prep.ts` with full trace_prepare logic
- ✅ Mounted `POST /mcp/trace_prep` route in `src/server.ts` with authentication
- ✅ Added comprehensive unit tests (15 tests, all passing)
- ✅ Added integration tests for full flow
- ✅ Fixed TypeScript errors (query parameter for searchMemories)
- ✅ 89% code coverage for trace-prep.ts

---

### Story 1.2: Update Persona Schema and Data

**Why:** Personas need `allowedTools` array for dynamic MCP tool scoping  
**Acceptance Criteria:** All personas have allowedTools, Casey has trace_update permission

#### Tasks

- [ ] Update persona schema
  - [ ] Add `allowedTools: text('allowed_tools').array().notNull()` to `src/db/schema.ts`
  - [ ] Verify `systemPrompt` field exists (or add if missing)
  - [ ] Create migration `drizzle/0009_persona_allowed_tools.sql`
  - [ ] Test migration forward and backward

- [ ] Update persona data files (`data/personas/`)
  - [ ] `casey.json`:
    ```json
    {
      "name": "casey",
      "role": "Showrunner",
      "allowedTools": [
        "trace_update",
        "memory_search",
        "memory_store",
        "handoff_to_agent"
      ],
      "systemPrompt": "You are Casey, the Showrunner..."
    }
    ```
  - [ ] `iggy.json`: Add allowedTools (no trace_update)
  - [ ] `riley.json`: Add allowedTools (no trace_update)
  - [ ] `veo.json`: Add allowedTools (no trace_update)
  - [ ] `alex.json`: Add allowedTools (no trace_update)
  - [ ] `quinn.json`: Add allowedTools (no trace_update)
  - [ ] All personas need complete system prompt templates

- [ ] Update seed script
  - [ ] Modify `scripts/db/seed-personas.ts` to read allowedTools
  - [ ] Ensure script seeds allowedTools to database

- [ ] Update repository
  - [ ] Ensure `PersonaRepository.findByName()` returns allowedTools
  - [ ] Add unit tests for allowedTools field

- [ ] Run migration and seed
  - [ ] Execute `npm run db:migrate`
  - [ ] Execute `npm run db:seed`
  - [ ] Verify personas table has allowedTools populated
  - [ ] Test rollback: `npm run db:test:rollback`

**Definition of Done:**

- [x] Persona schema has `allowedTools` array field
- [x] All 6 persona JSON files have allowedTools defined
- [x] Casey has trace_update, others don't
- [x] All personas have complete systemPrompt
- [x] Seed script populates allowedTools
- [x] Migration runs forward and backward cleanly
- [x] Unit tests pass

---

### Story 1.3: Update Project Schema for Workflow

**Why:** Projects need singular `workflow` array and `optionalSteps` for flexible pipelines  
**Acceptance Criteria:** AISMR and GenReact projects configured with workflow arrays

#### Tasks

- [ ] Update project schema
  - [ ] Change `workflows` → `workflow` (singular) in `src/db/schema.ts`
  - [ ] Add `optionalSteps: text('optional_steps').array().notNull().default(sql\`ARRAY[]::text[]\`)`
  - [ ] Create migration `drizzle/0010_project_workflow_singular.sql`
  - [ ] Test migration forward and backward

- [ ] Update project data files (`data/projects/`)
  - [ ] `aismr.json`:
    ```json
    {
      "name": "aismr",
      "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
      "optionalSteps": [],
      "specs": {
        "videoCount": 12,
        "videoDuration": 10.0
      }
    }
    ```
  - [ ] Create `genreact.json`:
    ```json
    {
      "name": "genreact",
      "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
      "optionalSteps": ["alex"],
      "specs": {
        "videoCount": 6,
        "videoDuration": 8.0,
        "generations": [
          "Silent",
          "Boomer",
          "GenX",
          "Millennial",
          "GenZ",
          "Alpha"
        ]
      }
    }
    ```

- [ ] Update seed script
  - [ ] Modify `scripts/db/seed-projects.ts` to read workflow/optionalSteps
  - [ ] Ensure script seeds both fields

- [ ] Update repository
  - [ ] Ensure `ProjectRepository` returns workflow/optionalSteps
  - [ ] Add validation: optionalSteps must be subset of workflow
  - [ ] Add unit tests for new fields

- [ ] Run migration and seed
  - [ ] Execute `npm run db:migrate`
  - [ ] Execute `npm run db:seed`
  - [ ] Verify projects table updated
  - [ ] Test rollback: `npm run db:test:rollback`

**Definition of Done:**

- [x] Project schema has `workflow` (singular) array
- [x] Project schema has `optionalSteps` array
- [x] AISMR project configured with workflow
- [x] GenReact project created with workflow and optional alex
- [x] Migration runs cleanly
- [x] Validation ensures optionalSteps ⊆ workflow
- [x] Unit tests pass

---

### Story 1.4: Security Hardening & Input Validation

**Why:** Address security vulnerabilities and input validation gaps identified in code review  
**Acceptance Criteria:** Sensitive data not logged, input validation added, error messages sanitized

#### Tasks

- [ ] Fix sensitive data in logs (`src/server.ts:132-148`)
  - [ ] Remove API key logging (even hashed) from production logs
  - [ ] Remove full headers logging in production
  - [ ] Add debug-only logger for detailed auth failures
  - [ ] Test: Verify production logs don't contain sensitive data

- [ ] Add input validation limits
  - [ ] Add max length to `query` field in `memory_search` schema (max 10000 chars)
  - [ ] Add max length to `content` field in `memory_store` schema (max 50000 chars)
  - [ ] Add max length to `instructions` field in trace tools (max 10000 chars)
  - [ ] Add validation tests for all limits

- [ ] Sanitize error messages (`src/server.ts:309-318`)
  - [ ] Return generic error messages in production
  - [ ] Include detailed errors only in logs (not client responses)
  - [ ] Add environment check: `process.env.NODE_ENV === 'production'`
  - [ ] Test: Verify production errors are sanitized

- [ ] Fix TypeScript import error (`tests/setup/database.ts:26`)
  - [ ] Change `import('./seed.ts')` to `import('./seed.js')`
  - [ ] Verify test setup works correctly
  - [ ] Run test suite to confirm fix

- [ ] Add database connection pool limits (`src/db/client.ts`)
  - [ ] Configure `max: 20` connections
  - [ ] Configure `idleTimeoutMillis: 30000`
  - [ ] Configure `connectionTimeoutMillis: 2000`
  - [ ] Document pool configuration

- [ ] Add session transport cleanup (`src/server.ts:43`)
  - [ ] Add TTL-based cleanup (30 minute timeout)
  - [ ] Add max size limit (1000 sessions) with LRU eviction
  - [ ] Add cleanup job that runs every 5 minutes
  - [ ] Test: Verify abandoned sessions are cleaned up

**Definition of Done:**

- [x] Sensitive data not logged in production
- [x] Input validation limits added to all string fields
- [x] Error messages sanitized in production
- [x] TypeScript import error fixed
- [x] Database pool limits configured
- [x] Session transport cleanup implemented
- [x] All security tests pass

---

## 📋 Epic 2: Complete Universal Workflow

**Duration:** 3-4 days  
**Status:** 🟡 In Progress (75% complete)  
**Prerequisites:** ✅ Epic 1 complete  
**Goal:** Finish myloware-agent.workflow.json configuration

### Story 2.1: Configure trace_prep HTTP Request Node ✅ COMPLETE

**Why:** Workflow needs to call trace_prep endpoint with correct parameters  
**Acceptance Criteria:** trace_prep node successfully calls endpoint and receives assembled prompt

#### Tasks

- [x] Update `Edit Fields` node (normalize inputs)
  - [x] Extract `traceId` from webhook body
  - [x] Extract `sessionId` from Telegram userId or chat session
  - [x] Extract `message` from Telegram or chat input
  - [x] Set `source` field (telegram, chat, webhook)

- [x] Update `trace_prep` HTTP Request node
  - [x] Set Method: POST
  - [x] Set URL: Hard-code `https://mcp-vector.mjames.dev/mcp/trace_prep` (n8n Cloud requires literal URLs)
  - [x] Configure Auth: Use existing MCP credentials
  - [x] Set Body with correct JSON structure

- [x] Test trace_prep call manually
  - [x] From Telegram trigger (no traceId) - creates new trace ✅
  - [x] From webhook trigger (with traceId) - loads existing trace ✅
  - [x] Response has systemPrompt, allowedTools, traceId ✅
  - [x] Response includes memorySummary ✅

**Definition of Done:**

- [x] trace_prep node successfully calls endpoint ✅
- [x] Creates new trace when no traceId ✅
- [x] Loads existing trace when traceId provided ✅
- [x] Response includes systemPrompt, allowedTools ✅
- [x] Edit Fields normalizes all trigger inputs ✅

---

### Story 2.2: Configure AI Agent Node with Dynamic Tools ✅ COMPLETE

**Why:** AI agent needs to receive assembled prompt and scoped tools  
**Acceptance Criteria:** AI Agent receives correct systemPrompt, only allowed tools exposed

#### Tasks

- [x] Update `AI Agent: Persona Execution` AI Agent node
  - [x] System prompt: `={{ $json.systemPrompt }}` (from trace_prep)
  - [x] User message: `={{ $json.instructions }}` (from trace_prep)
  - [x] Prompt assembly verified ✅

- [x] Update `MCP Client` tool node
  - [x] Set `includeTools`: `={{ $('Prepare Trace Context').item.json.allowedTools }}`
  - [x] Dynamic tool filtering works ✅

- [x] Test AI Agent execution
  - [x] Casey initialization tested ✅
  - [x] Casey loads correctly ✅
  - [x] Casey calls handoff_to_agent to Iggy ✅
  - [x] Iggy loads correctly ✅
- [x] **VERIFY:** Tool filtering works correctly ✅
  - [x] Database updated: Casey has `trace_update` in allowedTools ✅
  - [x] Database updated: Iggy does NOT have `trace_update` in allowedTools ✅
  - [x] All personas have correct `allowed_tools` configured ✅

**Definition of Done:**

- [x] AI Agent receives complete systemPrompt from trace_prep ✅
- [x] MCP Client exposes only allowedTools from trace_prep ✅
- [x] Casey loads and hands off correctly ✅
- [x] Iggy loads correctly ✅
- [x] Tool filtering verified: Casey has `trace_update`, Iggy does not ✅

---

### Story 2.3: Test Complete Handoff Chain

**Why:** Validate handoff creates self-referential loop through same workflow  
**Acceptance Criteria:** Casey → Iggy → Riley → Veo → Alex → Quinn chain works

#### Tasks

- [ ] Verify `handoff_to_agent` tool implementation
  - [ ] Updates trace: `currentOwner = toAgent`, `workflowStep++`, `instructions`
  - [ ] Stores handoff memory tagged with traceId
  - [ ] Invokes webhook with `{ traceId }` only (not full trace)
  - [ ] Returns immediately (non-blocking)
  - [ ] Special targets: "complete" sets status, "error" sets failed

- [ ] Test handoff loop
  - [ ] Start workflow with traceId (simulates handoff)
  - [ ] Workflow calls trace_prep with traceId
  - [ ] trace_prep loads trace, finds currentOwner
  - [ ] Workflow becomes that persona
  - [ ] Agent calls handoff_to_agent to next persona
  - [ ] Webhook receives new traceId, loop repeats
  - [ ] Verify self-referential loop works

- [ ] Add safety timeout
  - [ ] After AI Agent completes, check if handoff_to_agent was called
  - [ ] If agent didn't handoff within N seconds, auto-handoff to "error"
  - [ ] Log warning about missing handoff

- [ ] Test special handoff targets
  - [ ] Handoff to "complete" doesn't invoke webhook
  - [ ] Handoff to "error" sets status = failed
  - [ ] Both terminal targets work correctly

**Definition of Done:**

- [x] handoff_to_agent updates trace ownership correctly
- [x] Webhook invocation uses same myloware-agent endpoint
- [x] Next workflow execution discovers new persona from trace
- [x] Self-referential loop works: Casey → Iggy → Riley → ...
- [x] Timeout catches agents that forget to handoff
- [x] Special targets ("complete", "error") work

---

### Story 2.4: Fix Race Conditions & Concurrency Issues ✅ COMPLETE

**Why:** Prevent concurrent handoffs from overwriting each other, ensure data consistency  
**Acceptance Criteria:** Optimistic locking implemented, concurrent handoffs handled correctly

#### Tasks

- [x] Fix trace update race condition (`src/db/repositories/trace-repository.ts`)
  - [x] Add optimistic locking to `updateWorkflow` method ✅
  - [x] Check `currentOwner` matches expected value before update ✅
  - [x] Throw error if trace was modified by another operation ✅
  - [x] Add retry logic with exponential backoff (max 3 retries) ✅
  - [x] Add unit test for concurrent handoffs ✅

- [x] Add integration test for concurrent handoffs
  - [x] Create `tests/integration/concurrent-handoffs.test.ts` ✅
  - [x] Simulate two agents trying to handoff simultaneously ✅
  - [x] Verify only one handoff succeeds ✅
  - [x] Verify failed handoff retries correctly ✅
  - [x] Verify trace state is consistent after conflicts ✅

- [x] Extract shared trace_prepare logic
  - [x] Create `src/utils/trace-prep.ts` with shared functions ✅
  - [x] Extract `buildCaseyPrompt`, `buildPersonaPrompt`, `deriveAllowedTools` ✅
  - [x] Update `src/mcp/tools.ts` to use shared functions ✅
  - [x] Update `src/api/routes/trace-prep.ts` to use shared functions ✅
  - [x] Remove code duplication ✅

- [x] Add transaction support for critical operations
  - [x] Wrap `handoff_to_agent` updates in transaction ✅
  - [x] Ensure memory storage and trace update are atomic ✅
  - [x] Add rollback on failure ✅
  - [x] Test: Verify atomicity of handoff operations ✅

**Definition of Done:**

- [x] Optimistic locking implemented in trace updates ✅
- [x] Concurrent handoff test passes ✅
- [x] Shared trace_prepare logic extracted ✅
- [x] Code duplication eliminated ✅
- [x] Transaction support added for critical operations ✅
- [x] All tests pass ✅

---

## 📋 Epic 3: Quinn Direct Notification

**Duration:** 1-2 days  
**Status:** 🔴 Not Started  
**Prerequisites:** ⛔ Epic 2 must complete first  
**Goal:** Quinn sends final user notification (no Casey blocking)

### Story 3.1: Implement Quinn Notification Logic

**Why:** Quinn should notify user directly when publishing completes  
**Acceptance Criteria:** User receives "video is live" message with URL

#### Tasks

- [ ] Update Quinn persona prompt
  - [ ] Add to `data/personas/quinn.json`: "After successful publish, use handoff_to_agent with toAgent='complete' and instructions containing publish URL"
  - [ ] Quinn should store final platform URL in memory before handoff
  - [ ] Update system prompt template

- [ ] Create notification helper in handoff tool
  - [ ] When `toAgent === "complete"` and trace has sessionId
  - [ ] Look up original user session from trace
  - [ ] Send Telegram message: "✅ Your {project} video is live! {outputs.url}"
  - [ ] Mark trace as completed
  - [ ] Store completion memory

- [ ] Test Quinn → complete flow
  - [ ] Quinn stores publish URL in memory
  - [ ] Quinn calls handoff_to_agent({ toAgent: "complete", instructions: "Published to TikTok at {url}" })
  - [ ] System sends notification to user's Telegram
  - [ ] Trace status = "completed"
  - [ ] No Casey interaction needed

**Definition of Done:**

- [x] Quinn's persona includes notification instructions
- [x] handoff_to_agent("complete") sends Telegram notification
- [x] User receives "video is live" message with URL
- [x] Trace marked completed
- [x] No Casey blocking loop needed

---

## 📋 Epic 4: Async Operations (Veo/Alex)

**Duration:** 3-4 days  
**Status:** 🔴 Not Started  
**Prerequisites:** ⛔ Epic 2 must complete first  
**Goal:** Long-running video generation and editing don't block AI nodes

### Story 4.1: Video Generation toolWorkflow Pattern

**Why:** Veo needs to spawn N concurrent video generation jobs without blocking  
**Acceptance Criteria:** Veo generates 12 videos, AI node doesn't time out

#### Tasks

- [ ] Update Veo persona prompt
  - [ ] "For each screenplay, call the video generation tool"
  - [ ] "Store each video URL in memory as it completes"
  - [ ] "Once all N videos complete, call handoff_to_agent to alex"
  - [ ] Update `data/personas/veo.json`

- [ ] Verify `toolWorkflow` for video generation
  - [ ] AI agent calls toolWorkflow node (line 247 in workflow JSON)
  - [ ] toolWorkflow calls `Generate Video` workflow
  - [ ] That workflow handles async polling/waiting
  - [ ] Returns video URL when complete
  - [ ] AI agent receives URL, stores in memory

- [ ] Update video generation workflow
  - [ ] Input: `{ traceId, scriptId, screenplay }`
  - [ ] Create job in `video_generation_jobs` table
  - [ ] Call provider API (async)
  - [ ] Use `Wait` node to poll until complete
  - [ ] Return `{ videoUrl }`
  - [ ] Update job status to succeeded
  - [ ] Map Shotstack Serve API fields (`status`, `outputs.renditions[].url`, `executionTime`) into ledger updates per official documentation

- [ ] Test Veo flow
  - [ ] Veo receives 12 screenplays from memory
  - [ ] Veo calls video generation tool 12 times (sequential or parallel)
  - [ ] Each call blocks until that video completes
  - [ ] All URLs stored in memory with traceId tag
  - [ ] Veo hands off to Alex

**Definition of Done:**

- [x] Veo's AI node calls toolWorkflow for video generation
- [x] toolWorkflow handles async polling internally
- [x] AI node receives video URL when complete
- [x] Veo stores URLs in memory with traceId tag
- [x] video_generation_jobs table updated with status

---

### Story 4.2: Edit toolWorkflow Pattern

**Why:** Alex needs to stitch videos without blocking AI node  
**Acceptance Criteria:** Alex stitches compilation, AI node doesn't time out

#### Tasks

- [ ] Update Alex persona prompt
  - [ ] "Load all video URLs from memory (persona:veo, traceId:{current})"
  - [ ] "Call the edit tool to stitch them into compilation"
  - [ ] "Store final video URL in memory"
  - [ ] "Call handoff_to_agent to quinn"
  - [ ] Update `data/personas/alex.json`

- [ ] Verify `toolWorkflow` for editing
  - [ ] AI agent calls toolWorkflow node (line 205 in workflow JSON)
  - [ ] toolWorkflow calls `Edit_AISMR` workflow
  - [ ] That workflow handles async stitching
  - [ ] Returns final video URL

- [ ] Update edit workflow
  - [ ] Input: `{ traceId, videoUrls[] }`
  - [ ] Create job in `edit_jobs` table
  - [ ] Call Shotstack API
  - [ ] Use `Wait` node to poll until render completes
  - [ ] Return `{ finalUrl }`
  - [ ] Update job status
  - [ ] Persist Shotstack asset metadata (`renderId`, `status`, `url`) in the ledger following Serve API response structure

- [ ] Test Alex flow
  - [ ] Alex loads video URLs from memory
  - [ ] Alex calls edit tool with URLs
  - [ ] toolWorkflow handles stitching
  - [ ] Alex receives final URL
  - [ ] Alex stores final URL in memory
  - [ ] Alex hands off to Quinn

**Definition of Done:**

- [x] Alex's AI node calls toolWorkflow for editing
- [x] toolWorkflow handles async stitching
- [x] AI node receives final URL when complete
- [x] Alex stores final URL in memory
- [x] edit_jobs table updated

---

## 📋 Epic 5: Testing & Validation

**Duration:** 3-4 days  
**Status:** 🔴 Not Started  
**Prerequisites:** ⛔ Epic 4 must complete first  
**Goal:** Comprehensive testing of complete system

### Story 5.1: Integration Test - Trace Ownership Flow

**Why:** Validate trace ownership transfers correctly through handoffs  
**Acceptance Criteria:** All ownership transitions tested, workflowStep increments

#### Tasks

- [ ] Create `tests/integration/trace-ownership-flow.test.ts`
  - [ ] Create trace with Casey as owner
  - [ ] Simulate handoff to Iggy
  - [ ] Verify trace.currentOwner = "iggy"
  - [ ] Verify trace.previousOwner = "casey"
  - [ ] Verify trace.workflowStep = 1
  - [ ] Continue through full chain: Casey → Iggy → Riley → Veo → Alex → Quinn
  - [ ] Verify handoff to "complete" sets status

- [ ] Test special targets
  - [ ] Handoff to "complete" doesn't invoke webhook
  - [ ] Handoff to "error" sets status = failed
  - [ ] Both work correctly

- [ ] Run test suite
  - [ ] Execute `TEST_DB_USE_CONTAINER=1 npx vitest run tests/integration`
  - [ ] All tests pass
  - [ ] Coverage maintained ≥50%

**Definition of Done:**

- [x] All ownership transitions tested
- [x] previousOwner tracked correctly
- [x] workflowStep increments
- [x] Special targets work (complete, error)
- [x] Test passes consistently

---

### Story 5.2: E2E Test - AISMR Happy Path

**Why:** Validate complete AISMR production flow end-to-end  
**Acceptance Criteria:** Full flow completes, user notified, test runs < 5 minutes

#### Tasks

- [ ] Create `tests/e2e/aismr-happy-path.test.ts`
  - [ ] Mock Telegram message: "Make candles"
  - [ ] Mock trace_prep endpoint responses
  - [ ] Mock video generation API
  - [ ] Mock editing API
  - [ ] Mock TikTok publish API
  - [ ] Mock Shotstack Serve API responses using documented `status`, `renderId`, and `url` fields
  - [ ] Mock OpenAI Responses API outputs with the canonical `input` array structure

- [ ] Simulate full flow
  - [ ] Casey determines project = aismr
  - [ ] Iggy generates 12 modifiers
  - [ ] Riley writes 12 screenplays
  - [ ] Veo generates 12 videos
  - [ ] Alex stitches compilation
  - [ ] Quinn publishes and notifies user

- [ ] Verify end state
  - [ ] Trace status = completed
  - [ ] All memories tagged with traceId
  - [ ] User receives notification
  - [ ] Final video URL exists

- [ ] Run test suite
  - [ ] Execute `npm run test:e2e`
  - [ ] Test completes in < 5 minutes
  - [ ] All assertions pass

**Definition of Done:**

- [x] Full AISMR flow completes successfully
- [x] All 6 personas execute in order
- [x] Final video URL returned
- [x] User notified
- [x] Test runs in < 5 minutes

---

### Story 5.3: E2E Test - GenReact with Optional Step Skip

**Why:** Validate GenReact flow with Alex optionally skipped  
**Acceptance Criteria:** GenReact flow completes, Alex skipped when appropriate

#### Tasks

- [ ] Create `tests/e2e/genreact-optional-skip.test.ts`
  - [ ] Simulate "Make a simple generational AI video"
  - [ ] Mock all external APIs
  - [ ] Ensure Shotstack mocks use Serve API schema for both render and skip paths
  - [ ] Use OpenAI Responses-formatted fixtures for persona outputs
  - [ ] Veo decides videos are good quality (no editing needed)
  - [ ] Veo hands off directly to Quinn (skips Alex)

- [ ] Verify optional skip logic
  - [ ] workflowStep accounting correct
  - [ ] Quinn receives videos directly
  - [ ] Alex never executed
  - [ ] Trace reflects skip in metadata

- [ ] Test happy path with Alex
  - [ ] Veo decides editing needed
  - [ ] Veo hands off to Alex
  - [ ] Alex stitches and hands off to Quinn
  - [ ] Full workflow completes

- [ ] Run test suite
  - [ ] Execute `npm run test:e2e`
  - [ ] Both scenarios pass
  - [ ] Coverage maintained

**Definition of Done:**

- [x] GenReact flow completes with 6 videos
- [x] Alex skipped when appropriate
- [x] Quinn publishes successfully
- [x] Both skip and non-skip scenarios tested

---

### Story 5.4: Improve Test Coverage & Add Missing Integration Tests

**Why:** Increase test coverage from 66.70% to ≥80%, add missing integration tests  
**Acceptance Criteria:** Coverage ≥80%, all critical flows have integration tests

#### Tasks

- [ ] Add missing integration tests
  - [ ] Create `tests/integration/memory-search-graph-expansion.test.ts`
    - [ ] Test graph expansion with multiple hops
    - [ ] Test temporal boosting integration
    - [ ] Test RRF combination
  - [ ] Create `tests/integration/concurrent-handoffs.test.ts` (see Story 2.4)
  - [ ] Create `tests/integration/session-context-flow.test.ts`
    - [ ] Test session creation and updates
    - [ ] Test context persistence
    - [ ] Test persona/project resolution

- [ ] Increase unit test coverage
  - [ ] Add error path tests for all tool handlers
  - [ ] Add edge case tests for repository methods
  - [ ] Add authentication/authorization flow tests
  - [ ] Target: ≥80% coverage for all source files

- [ ] Add performance tests
  - [ ] Test memory search with large datasets (1000+ memories)
  - [ ] Test concurrent trace operations
  - [ ] Test embedding generation performance
  - [ ] Document performance baselines

- [ ] Fix test cleanup issues
  - [ ] Ensure all tests clean up after themselves
  - [ ] Add `afterEach` hooks where needed
  - [ ] Verify no test data leaks between tests
  - [ ] Run full test suite to verify cleanup

- [ ] Run coverage analysis
  - [ ] Execute `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit --coverage`
  - [ ] Identify uncovered code paths
  - [ ] Prioritize critical paths for coverage
  - [ ] Document coverage goals per module

**Definition of Done:**

- [x] Test coverage ≥80% (up from 66.70%)
- [x] All critical flows have integration tests
- [x] Error paths tested for all tool handlers
- [x] Test cleanup verified (no leaks)
- [x] Performance tests added
- [x] Coverage report generated and reviewed

---

## 📋 Epic 6: Documentation & Polish

**Duration:** 2-3 days  
**Status:** 🔴 Not Started  
**Prerequisites:** ⛔ Epic 5 must complete first  
**Goal:** Complete documentation for production readiness

### Story 6.1: Update Core Documentation

**Why:** Docs must reflect new trace-centric architecture  
**Acceptance Criteria:** All docs current, no broken links, examples tested

#### Tasks

- [ ] Update `docs/ARCHITECTURE.md`
  - [ ] Document trace_prep endpoint pattern
  - [ ] Document universal workflow structure
  - [ ] Document agent self-discovery
  - [ ] Remove references to separate workflow files

- [ ] Update `docs/MCP_TOOLS.md`
  - [ ] Document all trace tools (create, update, prepare)
  - [ ] Document handoff_to_agent with special targets
  - [ ] Document job tools (summary, upsert)
  - [ ] Add examples for each tool

- [ ] Update `docs/MCP_PROMPT_NOTES.md`
  - [ ] Document trace_prep response format
  - [ ] Document agent prompt assembly
  - [ ] Document tool scoping by persona
  - [ ] Add example prompts for each persona

- [ ] Update `AGENTS.md`
  - [ ] Document single workflow pattern
  - [ ] Update quick reference examples
  - [ ] Document trace_prep endpoint

- [ ] Verify all docs
  - [ ] Test all code examples
  - [ ] Check all links
  - [ ] Consistent formatting
  - [ ] No references to old patterns
  - [ ] Align terminology with `docs/official-documentation/*` references (OpenAI, n8n, Shotstack, MCP)

**Definition of Done:**

- [x] All docs reflect trace-centric architecture
- [x] No references to old per-agent workflows
- [x] Examples tested and accurate
- [x] No broken links

---

### Story 6.2: Create New Documentation

**Why:** New patterns need dedicated docs  
**Acceptance Criteria:** 3 new docs created with comprehensive coverage

#### Tasks

- [ ] Create `docs/TRACE_STATE_MACHINE.md`
  - [ ] Explain trace ownership model
  - [ ] Diagram state transitions
  - [ ] Document trace lifecycle
  - [ ] Include SQL queries for debugging

- [ ] Create `docs/UNIVERSAL_WORKFLOW.md`
  - [ ] Document myloware-agent.workflow.json structure
  - [ ] Explain 3-node pattern (Edit Fields → trace_prep → AI Agent)
  - [ ] Document trace_prep HTTP endpoint
  - [ ] Include troubleshooting guide

- [ ] Create `docs/ASYNC_PATTERNS.md`
  - [ ] Document toolWorkflow pattern
  - [ ] Document Wait node usage
  - [ ] Document job ledger pattern
  - [ ] Include examples from Veo/Alex

- [ ] Cross-reference docs
  - [ ] Link from ARCHITECTURE.md
  - [ ] Link from MCP_TOOLS.md
  - [ ] Update README.md

**Definition of Done:**

- [x] All 3 new docs created
- [x] Comprehensive coverage
- [x] Cross-referenced with existing docs

---

### Story 6.3: Final Code Quality & Type Safety

**Why:** Ensure production-ready code with full type safety  
**Acceptance Criteria:** All quality checks pass, coverage ≥80%, no `any` types

#### Tasks

- [ ] Eliminate `any` types (11 instances found)
  - [ ] Fix `src/mcp/prompts.ts:47` - Use proper `PromptDefinition` type
  - [ ] Fix `src/utils/response-formatter.ts:4-5` - Use generic type constraints
  - [ ] Fix `src/config/index.ts:117` - Use proper enum type for logLevel
  - [ ] Fix `src/api/routes/trace-prep.ts:231` - Use proper memory type
  - [ ] Fix `src/db/repositories/session-repository.ts:109` - Use proper context type
  - [ ] Fix `src/utils/workflow-params.ts:181,196` - Use proper content types
  - [ ] Fix `src/clients/openai.ts:26` - Use proper OpenAI types
  - [ ] Fix `src/db/repositories/workflow-run-repository.ts:51,108` - Use proper update types
  - [ ] Fix `src/tools/memory/evolveTool.ts:66` - Use proper array type
  - [ ] Verify no `any` types remain: `grep -r "as any\|: any" src/`

- [ ] Extract magic numbers to constants
  - [ ] `DEFAULT_MEMORY_LIMIT = 12` (from `src/mcp/tools.ts:562`)
  - [ ] `TEMPORAL_DECAY_FACTOR = 0.1` (from `src/tools/memory/searchTool.ts:78`)
  - [ ] `MAX_RETRIES = 3` (from `src/integrations/n8n/client.ts:66`)
  - [ ] `SESSION_TTL_MS = 30 * 60 * 1000` (30 minutes)
  - [ ] `MAX_SESSIONS = 1000`
  - [ ] Document all constants with comments

- [ ] Refactor long functions
  - [ ] Extract helper functions from `tracePrepareTool.handler` (180 lines)
  - [ ] Extract helper functions from `handleTracePrep` (218 lines)
  - [ ] Target: No function > 100 lines
  - [ ] Add JSDoc comments to all extracted functions

- [ ] Run all quality checks
  - [ ] `npm run lint` - no errors
  - [ ] `npm run type-check` - no errors
  - [ ] `npm run format:check` - all formatted
  - [ ] `npm run check:legacy-tools` - no forbidden tools
  - [ ] Remove console.logs
  - [ ] Remove commented code
  - [ ] Verify no `any` types: `npm run type-check` should catch all

- [ ] Run test suite
  - [ ] `npm run test:coverage`
  - [ ] Coverage ≥ 80% (target, up from 66.70%)
  - [ ] All tests pass
  - [ ] No skipped tests

- [ ] Documentation
  - [ ] All code examples tested
  - [ ] No broken links
  - [ ] Consistent formatting
  - [ ] Up-to-date with code
  - [ ] Document all constants and their purposes

- [ ] Final verification
  - [ ] All husky hooks pass
  - [ ] CI passes
  - [ ] Deployment checklist complete
  - [ ] Type safety verified (no `any` types)

**Definition of Done:**

- [x] All `any` types eliminated (0 instances)
- [x] All quality checks pass
- [x] Coverage target met (≥80%)
- [x] Magic numbers extracted to constants
- [x] Long functions refactored
- [x] Production-ready
- [x] Ready for deployment

---

## 🚨 Risks & Mitigations

### High Risk

**1. trace_prep endpoint implementation**

- **Risk:** Need to decide between HTTP wrapper vs workflow refactor; prompt assembly logic complex
- **Current State:** `trace_prepare` MCP tool exists with full logic - can be reused
- **Mitigation:** Build HTTP endpoint wrapper around existing `trace_prepare` handler (Option A)
- **Contingency:** Refactor workflow to use MCP Client node if HTTP endpoint proves problematic

**2. MCP Client dynamic tool filtering**

- **Risk:** n8n MCP Client might not support dynamic includeTools array
- **Mitigation:** Test early in Epic 2, Story 2.2
- **Contingency:** Create conditional branches per persona if needed

**3. AI agents forgetting to handoff**

- **Risk:** Agent completes work but doesn't call handoff_to_agent
- **Mitigation:** Add timeout safety node (Story 2.3)
- **Contingency:** Add postprocessing node that always calls handoff

### Medium Risk

**4. Long-running operations blocking**

- **Risk:** Video generation takes 2+ minutes, blocks AI node
- **Mitigation:** Use toolWorkflow with internal Wait nodes
- **Contingency:** Spawn separate workflows, use job ledger to track

**5. Project determination complexity**

- **Risk:** Casey might misidentify project from user message
- **Mitigation:** Add explicit project keywords, fallback to HITL
- **Contingency:** Let user specify project explicitly in message

**6. Race conditions in concurrent handoffs**

- **Risk:** Two agents handoff simultaneously, one overwrites the other
- **Mitigation:** Add optimistic locking to trace updates (Story 2.4)
- **Contingency:** Use database-level row locking if optimistic locking insufficient

**7. Type safety regressions**

- **Risk:** `any` types reduce compile-time safety, hide bugs
- **Mitigation:** Eliminate all `any` types, use proper TypeScript types (Story 6.3)
- **Contingency:** Add ESLint rule to prevent `any` types

---

## 📊 Quick Reference

### Key Files to Create

```
src/api/routes/trace-prep.ts                     ← NEW (Story 1.1) ✅ COMPLETED - HTTP wrapper for trace_prepare
src/api/utils/prompt-builder.ts                  ← NEW (Story 1.1 helper) - Extract from tools.ts if needed
tests/unit/api/trace-prep.test.ts                ← NEW (Story 1.1) ✅ COMPLETED
tests/integration/trace-prep-endpoint.test.ts    ← NEW (Story 1.1) ✅ COMPLETED
NOTE: trace_prepare MCP tool exists at src/mcp/tools.ts:545-661 - reuse logic
src/utils/trace-prep.ts                          ← NEW (Story 2.4) - Shared trace_prepare logic
src/utils/constants.ts                            ← NEW (Story 6.3) - Magic number constants
drizzle/0009_persona_allowed_tools.sql           ← NEW (Story 1.2)
drizzle/0010_project_workflow_singular.sql       ← NEW (Story 1.3)
tests/integration/concurrent-handoffs.test.ts    ← NEW (Story 2.4) - Race condition tests
tests/integration/memory-search-graph-expansion.test.ts ← NEW (Story 5.4)
tests/integration/session-context-flow.test.ts    ← NEW (Story 5.4)
tests/integration/trace-ownership-flow.test.ts   ← NEW (Story 5.1)
tests/e2e/aismr-happy-path.test.ts               ← NEW (Story 5.2)
tests/e2e/genreact-optional-skip.test.ts         ← NEW (Story 5.3)
docs/TRACE_STATE_MACHINE.md                      ← NEW (Story 6.2)
docs/UNIVERSAL_WORKFLOW.md                       ← NEW (Story 6.2)
docs/ASYNC_PATTERNS.md                           ← NEW (Story 6.2)
```

### Key Files to Update

```
workflows/myloware-agent.workflow.json           (Stories 2.1, 2.2)
src/db/schema.ts                                 (Stories 1.2, 1.3)
src/db/client.ts                                 (Story 1.4) - Add pool limits
src/db/repositories/trace-repository.ts        (Story 2.4) - Add optimistic locking
src/server.ts                                    (Stories 1.4, 2.4) - Security fixes, session cleanup
src/mcp/tools.ts                                 (Stories 2.4, 3.1) - Extract shared logic, add notification
src/api/routes/trace-prep.ts                     (Story 2.4) - Use shared logic
src/utils/response-formatter.ts                   (Story 6.3) - Fix type safety
src/config/index.ts                              (Story 6.3) - Fix logLevel type
tests/setup/database.ts                          (Story 1.4) - Fix import error
data/personas/*.json                             (Story 1.2)
data/projects/*.json                             (Story 1.3)
docs/ARCHITECTURE.md                             (Story 6.1)
docs/MCP_TOOLS.md                                (Story 6.1)
docs/MCP_PROMPT_NOTES.md                         (Story 6.1)
AGENTS.md                                        (Story 6.1)
```

---

## 🎯 Success Criteria

### MVP (Minimum Viable Product)

- [ ] trace_prep HTTP endpoint works
- [ ] Personas have allowedTools
- [ ] Projects have workflow array
- [ ] myloware-agent workflow complete
- [ ] Handoff chain works: Casey → Iggy → Riley → Veo → Alex → Quinn
- [ ] Quinn notifies user
- [ ] Basic integration test passes

### Full Success

- [ ] All MVP criteria met
- [ ] Async operations work (Veo, Alex)
- [ ] E2E tests pass (AISMR, GenReact)
- [ ] All documentation updated
- [ ] Code quality checks pass
- [ ] Coverage ≥ 80% (up from 66.70%)
- [ ] All security issues addressed
- [ ] Race conditions fixed
- [ ] Type safety verified (no `any` types)

---

## 📈 Progress Tracking

### Epic Status

| Epic                                    | Stories | Status         | Blockers          |
| --------------------------------------- | ------- | -------------- | ----------------- |
| **Epic 1:** Server-Side Preprocessing   | 4       | ✅ Complete    | None              |
| **Epic 2:** Complete Universal Workflow | 4       | 🟡 In Progress | None (75% done)   |
| **Epic 3:** Quinn Direct Notification   | 1       | 🔴 Not Started | Epic 2            |
| **Epic 4:** Async Operations            | 2       | 🔴 Not Started | Epic 2            |
| **Epic 5:** Testing & Validation        | 4       | 🔴 Not Started | Epic 4            |
| **Epic 6:** Documentation & Polish      | 3       | 🔴 Not Started | Epic 5            |

**Total:** 18 stories across 6 epics  
**Completed:** 6 stories (Epic 1: 4 stories, Epic 2: Story 2.1, Story 2.2, Story 2.4)  
**In Progress:** 0 stories  
**Remaining:** 12 stories

---

## 🚀 Next Steps

**Immediate Action:** Complete Epic 2 verification tasks  
**Priority:** Verify tool filtering and test complete handoff chain

**Remaining Verification Tasks (Epic 2):**

1. ✅ **Story 2.2 Verification:** COMPLETE
   - ✅ Database updated: All personas have correct `allowed_tools`
   - ✅ Casey has `trace_update` in allowedTools
   - ✅ Iggy does NOT have `trace_update` in allowedTools

2. **Story 2.3: Test Complete Handoff Chain**
   - [ ] Test: Casey → Iggy → Riley → Veo → Alex → Quinn chain
   - [ ] Verify self-referential loop works (same workflow, different personas)
   - [ ] Test special handoff targets: "complete" and "error"
   - [ ] Add safety timeout: auto-handoff to "error" if agent doesn't handoff

**Critical Path:**

1. ✅ Epic 1: Server-Side Preprocessing (COMPLETE)
2. 🟡 Epic 2: Complete Universal Workflow (60% complete)
   - ✅ Story 2.1: trace_prep HTTP Request Node (COMPLETE)
   - 🟡 Story 2.2: AI Agent Node (IN PROGRESS - needs verification)
   - ⏳ Story 2.3: Test Complete Handoff Chain (NOT STARTED)
   - ✅ Story 2.4: Race Conditions (COMPLETE)
3. Epic 3-6: Parallel execution (5-7 days) - Blocked by Epic 2

**Estimated Remaining Duration:** 2-3 days to complete Epic 2 verification

---

## 📚 Reference Documents

- `docs/NORTH_STAR.md` - Vision and architectural walkthrough
- `AGENTS.md` - Quick reference for agent development
- `docs/ARCHITECTURE.md` - System architecture
- `docs/MCP_TOOLS.md` - Tool reference
- `docs/MCP_PROMPT_NOTES.md` - Prompt engineering guide
- `docs/plan-gpt5-codex.md` - High-level phase roadmap
- `docs/plan-v2-bridge.md` - Detailed implementation plan

---

**Last Updated:** November 7, 2025  
**Maintainer:** Development Team  
**Status:** 🚧 Ready to Start Epic 1
