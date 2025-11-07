# Bridge Plan: Current State → North Star V2

**Created:** November 7, 2025  
**Status:** 🚧 Draft - Ready for Review  
**Architecture:** Single Universal Workflow + Trace State Machine  
**Target:** North Star V2 (One workflow, self-discovering agents)

---

## 🎯 Executive Summary

This plan bridges the gap between your **current implementation** and the **North Star V2 vision**. 

**Key Architectural Decisions (from North Star conflicts):**
1. ✅ **trace_prep HTTP endpoint** - Single server-side call assembles complete prompt
2. ✅ **Agents call handoff_to_agent tool** - AI nodes own their handoffs
3. ✅ **Quinn notifies user directly** - No Casey blocking loop needed
4. ✅ **AI agents call toolWorkflow for async ops** - toolWorkflow handles Wait nodes internally
5. ✅ **workflow (singular) array** - One ordered pipeline per project
6. ✅ **Server-side discovery** - trace_prep endpoint does all context assembly

---

## 📊 Current State Assessment

### ✅ What's Already Done (Epic 1)

Based on git status and migrations:

- [x] **Trace schema updated** (`0005_add_owner_workflow.sql`)
  - `currentOwner`, `instructions`, `workflowStep`, `previousOwner` fields exist
  - Ownership tracking infrastructure in place

- [x] **Legacy tables removed** (`0006_drop_legacy_orchestration.sql`, `0007_drop_workflow_registry.sql`)
  - `agent_runs`, `handoff_tasks`, `run_events`, `workflow_registry` dropped
  - Repositories deleted (unstaged in git)

- [x] **Job ledger implemented** (`0008_job_ledger.sql`)
  - `video_generation_jobs` and `edit_jobs` tables exist
  - Repositories created: `video-jobs-repository.ts`, `edit-jobs-repository.ts`
  - Unit tests written: `edit-jobs-repository.test.ts`, `video-jobs-repository.test.ts`

- [x] **MCP tools partially implemented**
  - `trace_create`, `trace_update` exist in `tools.ts`
  - `handoff_to_agent` exists with special targets ("complete", "error")
  - `memory_store`, `memory_search` exist
  - Job tools exist: test file `job-tools.test.ts` visible in untracked files

- [x] **Workflow skeleton exists**
  - `myloware-agent.workflow.json` has 3 triggers (Telegram, Chat, Webhook)
  - Has Edit Fields → trace_prep → AI Agent structure
  - Has toolWorkflow nodes for external operations

### ⚠️ What's Partially Done

- [ ] **trace_prep HTTP endpoint** - Workflow references it, but **not implemented server-side**
  - `grep "trace_prep"` in src/ found no matches
  - Need to create endpoint at `POST /mcp/trace_prep`
  - Need to implement full server-side preprocessing logic

- [ ] **Workflow configuration incomplete**
  - trace_prep node is placeholder (line 262-268 in workflow JSON)
  - MCP Client `includeTools` references undefined variable (line 86)
  - AI Agent prompt references undefined `{{ $json.prompt }}` (line 50)

- [ ] **Project schema mismatch**
  - Current: `workflows: text('workflows').array()` (plural)
  - North Star needs: `workflow: text('workflow').array()` (singular)
  - Need: `optionalSteps: text('optional_steps').array()`

- [ ] **Persona schema missing fields**
  - Need: `allowedTools: text('allowed_tools').array()`
  - Current systemPrompt exists, but structure unclear

### ❌ What's Missing

- [ ] **trace_prep endpoint implementation** (Critical blocker!)
- [ ] **Persona data with allowedTools** (6 files need updates)
- [ ] **Project workflow field** (singular + optionalSteps)
- [ ] **Complete workflow configuration** (trace_prep body, MCP tool scoping)
- [ ] **Integration tests for trace flow**
- [ ] **E2E tests (AISMR, GenReact)**
- [ ] **Documentation updates**

---

## 🏗️ Implementation Plan

### Epic 1: Server-Side Preprocessing (CRITICAL PATH)

**Duration:** 2-3 days  
**Blockers:** None - start immediately  
**Goal:** Implement the trace_prep HTTP endpoint that does ALL preprocessing

#### Story 1.1: Create trace_prep HTTP Endpoint

**Why:** This is the heart of the universal workflow pattern. Without it, workflows can't discover their persona.

**Tasks:**

- [ ] Create `POST /mcp/trace_prep` endpoint in server
  - [ ] Location: `src/api/routes/trace-prep.ts` (new file)
  - [ ] Mount in main server: `src/server.ts`
  
- [ ] Implement endpoint logic:
  ```typescript
  // Input: { traceId?, sessionId?, instructions?, source?, metadata? }
  // Output: { traceId, systemPrompt, allowedTools, instructions, memories }
  
  async function tracePrep(req) {
    // 1. Get or create trace
    let trace;
    if (req.traceId) {
      trace = await traceRepo.findById(req.traceId);
    } else {
      // New trace from Telegram/Chat - default to Casey + unknown project
      trace = await traceRepo.create({
        projectId: 'unknown',
        sessionId: req.sessionId,
        currentOwner: 'casey',
        instructions: req.instructions,
        workflowStep: 0,
        status: 'active',
      });
    }
    
    // 2. Load persona config
    const persona = await personaRepo.findByName(trace.currentOwner);
    
    // 3. Build system prompt
    let systemPrompt;
    let memories = [];
    
    if (trace.projectId === 'unknown') {
      // Casey initialization mode - special prompt to determine project
      systemPrompt = buildCaseyInitPrompt(persona, trace);
    } else {
      // Standard agent mode
      const project = await projectRepo.findById(trace.projectId);
      memories = await memoryRepo.searchByTrace(trace.traceId);
      systemPrompt = buildAgentPrompt(persona, project, trace, memories);
    }
    
    // 4. Return everything assembled
    return {
      traceId: trace.traceId,
      systemPrompt,
      allowedTools: persona.allowedTools,
      instructions: trace.instructions,
      memories: memories.map(stripEmbedding),
    };
  }
  ```

- [ ] Create helper functions:
  - [ ] `buildCaseyInitPrompt(persona, trace)` - Special Casey prompt for unknown project
  - [ ] `buildAgentPrompt(persona, project, trace, memories)` - Standard agent prompt
  - [ ] Both should follow templates in North Star (lines 212-227, 327-346)

- [ ] Add unit tests (`tests/unit/api/trace-prep.test.ts`)
  - [ ] Test new trace creation (no traceId provided)
  - [ ] Test existing trace load (traceId provided)
  - [ ] Test Casey init prompt (projectId = 'unknown')
  - [ ] Test standard agent prompt (projectId known)
  - [ ] Test persona not found error
  - [ ] Test project not found error
  - [ ] Test memory search integration

- [ ] Add integration test (`tests/integration/trace-prep-endpoint.test.ts`)
  - [ ] Full flow: create trace → load → update → reload
  - [ ] Verify prompt assembly with real data
  - [ ] Verify memory integration

**Acceptance Criteria:**
- `POST /mcp/trace_prep` endpoint exists and responds
- Creates trace when no traceId (defaults: casey, unknown project)
- Loads trace when traceId provided
- Returns complete systemPrompt based on persona + project
- Returns allowedTools from persona config
- Returns memories filtered by traceId
- Unit tests pass (≥50% coverage)
- Integration test passes

---

#### Story 1.2: Update Persona Schema and Data

**Why:** Personas need `allowedTools` array for dynamic MCP tool scoping.

**Tasks:**

- [ ] Update persona schema (`src/db/schema.ts`)
  - [ ] Add `allowedTools: text('allowed_tools').array().notNull()`
  - [ ] Verify `systemPrompt` field exists (or add if missing)
  - [ ] Create migration `0009_persona_allowed_tools.sql`

- [ ] Update persona files in `data/personas/`
  - [ ] `casey.json`:
    ```json
    {
      "name": "casey",
      "role": "Showrunner",
      "allowedTools": ["trace_update", "memory_search", "memory_store", "handoff_to_agent"],
      "systemPrompt": "You are Casey, the Showrunner..."
    }
    ```
  - [ ] `iggy.json`, `riley.json`, `veo.json`, `alex.json`, `quinn.json`:
    ```json
    {
      "allowedTools": ["memory_search", "memory_store", "handoff_to_agent"]
    }
    ```
  - [ ] All personas need complete system prompt templates

- [ ] Update seed script (`scripts/db/seed-personas.ts`)
  - [ ] Read allowedTools from JSON files
  - [ ] Seed to database

- [ ] Run migration and seed
  - [ ] `npm run db:migrate`
  - [ ] `npm run db:seed`
  - [ ] Verify personas table has allowedTools

- [ ] Update PersonaRepository if needed
  - [ ] Ensure `findByName` returns allowedTools

**Acceptance Criteria:**
- Persona schema has `allowedTools` array field
- All 6 persona JSON files have allowedTools defined
- Casey has trace_update, others don't
- All personas have complete systemPrompt
- Seed script populates allowedTools
- Migration runs forward and backward cleanly

---

#### Story 1.3: Update Project Schema for Workflow

**Why:** Projects need singular `workflow` array and `optionalSteps` for flexible pipelines.

**Tasks:**

- [ ] Update project schema (`src/db/schema.ts`)
  - [ ] Change `workflows` → `workflow` (singular)
  - [ ] Add `optionalSteps: text('optional_steps').array().notNull().default(sql\`ARRAY[]::text[]\`)`
  - [ ] Create migration `0010_project_workflow_singular.sql`

- [ ] Update project files in `data/projects/`
  - [ ] `aismr.json`:
    ```json
    {
      "name": "aismr",
      "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
      "optionalSteps": [],
      "specs": { ... }
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
        "generations": ["Silent", "Boomer", "GenX", "Millennial", "GenZ", "Alpha"]
      }
    }
    ```

- [ ] Update seed script
- [ ] Update ProjectRepository if needed

**Acceptance Criteria:**
- Project schema has `workflow` (singular) array
- Project schema has `optionalSteps` array
- AISMR project configured with workflow
- GenReact project created with workflow and optional alex
- Migration runs cleanly

---

### Epic 2: Complete Universal Workflow

**Duration:** 3-4 days  
**Prerequisites:** Epic 1 complete (trace_prep endpoint must exist)  
**Goal:** Finish myloware-agent.workflow.json configuration

#### Story 2.1: Configure trace_prep HTTP Request Node

**Why:** The workflow needs to call the trace_prep endpoint with correct parameters.

**Tasks:**

- [ ] Update `trace_prep` HTTP Request node in workflow JSON
  - [ ] Method: POST
  - [ ] URL: `{{ $env.MCP_SERVER_URL }}/mcp/trace_prep` or hardcode `https://mcp-vector.mjames.dev/mcp/trace_prep`
  - [ ] Auth: Use existing MCP credentials
  - [ ] Body:
    ```json
    {
      "traceId": "={{ $('Edit Fields').item.json.traceId || null }}",
      "sessionId": "={{ $('Edit Fields').item.json.sessionId || $('Edit Fields').item.json.userId }}",
      "instructions": "={{ $('Edit Fields').item.json.message || $('Edit Fields').item.json.chatInput }}",
      "source": "={{ $('Edit Fields').item.json.source || 'webhook' }}",
      "metadata": {}
    }
    ```

- [ ] Update `Edit Fields` node to normalize inputs:
  - [ ] Extract `traceId` from webhook body
  - [ ] Extract `sessionId` from Telegram userId or chat session
  - [ ] Extract `message` from Telegram or chat input
  - [ ] Set `source` field (telegram, chat, webhook)

- [ ] Test trace_prep call manually:
  - [ ] From Telegram trigger (no traceId)
  - [ ] From webhook trigger (with traceId)
  - [ ] Verify response has systemPrompt, allowedTools, traceId

**Acceptance Criteria:**
- trace_prep node successfully calls endpoint
- Creates new trace when no traceId
- Loads existing trace when traceId provided
- Response includes systemPrompt, allowedTools, memories
- Edit Fields normalizes all trigger inputs

---

#### Story 2.2: Configure AI Agent Node with Dynamic Tools

**Why:** The AI agent needs to receive the assembled prompt and scoped tools.

**Tasks:**

- [ ] Update `Myloware Agent` AI Agent node:
  - [ ] System prompt: `={{ $('trace_prep').item.json.systemPrompt }}`
  - [ ] User message: `={{ $('Edit Fields').item.json.message || $('Edit Fields').item.json.chatInput }}`

- [ ] Update `MCP Client` tool node:
  - [ ] `includeTools`: `={{ $('trace_prep').item.json.allowedTools }}`
  - [ ] Verify this syntax works (n8n MCP Client supports dynamic tool filtering)
  - [ ] If not supported, create alternative: conditional nodes per persona

- [ ] Test AI Agent execution:
  - [ ] Mock Casey initialization (projectId unknown)
  - [ ] Verify Casey calls trace_update to set project
  - [ ] Verify Casey calls handoff_to_agent to Iggy
  - [ ] Mock Iggy execution (projectId known)
  - [ ] Verify Iggy has correct tools (no trace_update)

**Acceptance Criteria:**
- AI Agent receives complete systemPrompt from trace_prep
- MCP Client exposes only allowedTools from trace_prep
- Casey can call trace_update (has permission)
- Iggy cannot call trace_update (doesn't have permission)
- All agents can call memory_store, memory_search, handoff_to_agent

---

#### Story 2.3: Test Complete Handoff Chain

**Why:** Validate that handoff creates self-referential loop through same workflow.

**Tasks:**

- [ ] Verify `handoff_to_agent` tool implementation:
  - [ ] Updates trace: `currentOwner = toAgent`, `workflowStep++`, `instructions = ...`
  - [ ] Stores handoff memory
  - [ ] Invokes webhook with `{ traceId }` only (not full trace)
  - [ ] Returns immediately (non-blocking)
  - [ ] Special targets: "complete" sets status, "error" sets failed

- [ ] Test handoff loop:
  - [ ] Start workflow with traceId (simulates handoff)
  - [ ] Workflow calls trace_prep with traceId
  - [ ] trace_prep loads trace, finds currentOwner
  - [ ] Workflow becomes that persona
  - [ ] Agent calls handoff_to_agent to next persona
  - [ ] Webhook receives new traceId, loop repeats

- [ ] Add safety timeout:
  - [ ] After AI Agent completes, check if handoff_to_agent was called
  - [ ] If agent didn't handoff within N seconds, auto-handoff to "error"
  - [ ] Log warning about missing handoff

**Acceptance Criteria:**
- handoff_to_agent updates trace ownership correctly
- Webhook invocation uses same myloware-agent endpoint
- Next workflow execution discovers new persona from trace
- Self-referential loop works: Casey → Iggy → Riley → ...
- Timeout catches agents that forget to handoff

---

### Epic 3: Quinn Direct Notification

**Duration:** 1-2 days  
**Prerequisites:** Epic 2 complete  
**Goal:** Quinn sends final user notification (no Casey blocking)

#### Story 3.1: Implement Quinn Notification Logic

**Why:** Quinn should notify user directly when publishing completes.

**Tasks:**

- [ ] Update Quinn persona prompt (`data/personas/quinn.json`):
  - [ ] Add instruction: "After successful publish, use handoff_to_agent with toAgent='complete' and instructions containing publish URL"
  - [ ] Quinn should store final platform URL in memory before handoff

- [ ] Create notification helper in handoff tool:
  - [ ] When `toAgent === "complete"` and trace has sessionId
  - [ ] Look up original user session
  - [ ] Send Telegram message: "✅ Your {project} video is live! {outputs.url}"
  - [ ] Mark trace as completed

- [ ] Test Quinn → complete flow:
  - [ ] Quinn stores publish URL in memory
  - [ ] Quinn calls handoff_to_agent({ toAgent: "complete", instructions: "Published to TikTok at {url}" })
  - [ ] System sends notification to user's Telegram
  - [ ] Trace status = "completed"

**Acceptance Criteria:**
- Quinn's persona includes notification instructions
- handoff_to_agent("complete") sends Telegram notification
- User receives "video is live" message with URL
- Trace marked completed
- No Casey blocking loop needed

---

### Epic 4: Async Operations (Veo/Alex)

**Duration:** 3-4 days  
**Prerequisites:** Epic 2 complete  
**Goal:** Long-running video generation and editing don't block AI nodes

#### Story 4.1: Video Generation toolWorkflow Pattern

**Why:** Veo needs to spawn N concurrent video generation jobs without blocking.

**Tasks:**

- [ ] Update Veo persona prompt:
  - [ ] "For each screenplay, call the video generation tool"
  - [ ] "Store each video URL in memory as it completes"
  - [ ] "Once all N videos complete, call handoff_to_agent to alex"

- [ ] Verify `toolWorkflow` for video generation:
  - [ ] AI agent calls toolWorkflow node (line 247 in workflow JSON)
  - [ ] toolWorkflow calls `Generate Video` workflow
  - [ ] That workflow handles async polling/waiting
  - [ ] Returns video URL when complete
  - [ ] AI agent receives URL, stores in memory

- [ ] Update video generation workflow (`Generate Video` workflow):
  - [ ] Input: `{ traceId, scriptId, screenplay }`
  - [ ] Create job in `video_generation_jobs` table
  - [ ] Call provider API (async)
  - [ ] Use `Wait` node to poll until complete
  - [ ] Return `{ videoUrl }`
  - [ ] Update job status to succeeded

- [ ] Test Veo flow:
  - [ ] Veo receives 12 screenplays from memory
  - [ ] Veo calls video generation tool 12 times (can be sequential or AI chooses parallel)
  - [ ] Each call blocks until that video completes
  - [ ] All URLs stored in memory
  - [ ] Veo hands off to Alex

**Acceptance Criteria:**
- Veo's AI node calls toolWorkflow for video generation
- toolWorkflow handles async polling internally
- AI node receives video URL when complete
- Veo stores URLs in memory with traceId tag
- video_generation_jobs table updated with status

---

#### Story 4.2: Edit toolWorkflow Pattern

**Why:** Alex needs to stitch videos without blocking AI node.

**Tasks:**

- [ ] Update Alex persona prompt:
  - [ ] "Load all video URLs from memory (persona:veo, traceId:{current})"
  - [ ] "Call the edit tool to stitch them into compilation"
  - [ ] "Store final video URL in memory"
  - [ ] "Call handoff_to_agent to quinn"

- [ ] Verify `toolWorkflow` for editing:
  - [ ] AI agent calls toolWorkflow node (line 205 in workflow JSON)
  - [ ] toolWorkflow calls `Edit_AISMR` workflow
  - [ ] That workflow handles async stitching
  - [ ] Returns final video URL

- [ ] Update edit workflow (`Edit_AISMR` workflow):
  - [ ] Input: `{ traceId, videoUrls[] }`
  - [ ] Create job in `edit_jobs` table
  - [ ] Call Shotstack API
  - [ ] Use `Wait` node to poll until render completes
  - [ ] Return `{ finalUrl }`

**Acceptance Criteria:**
- Alex's AI node calls toolWorkflow for editing
- toolWorkflow handles async stitching
- AI node receives final URL when complete
- Alex stores final URL in memory
- edit_jobs table updated

---

### Epic 5: Testing & Validation

**Duration:** 3-4 days  
**Prerequisites:** Epic 4 complete  
**Goal:** Comprehensive testing of complete system

#### Story 5.1: Integration Test - Trace Ownership Flow

**Why:** Validate trace ownership transfers correctly through handoffs.

**Tasks:**

- [ ] Create `tests/integration/trace-ownership-flow.test.ts`
  - [ ] Create trace with Casey as owner
  - [ ] Simulate handoff to Iggy
  - [ ] Verify trace.currentOwner = "iggy"
  - [ ] Verify trace.previousOwner = "casey"
  - [ ] Verify trace.workflowStep = 1
  - [ ] Continue through full chain: Casey → Iggy → Riley → Veo → Alex → Quinn
  - [ ] Verify handoff to "complete" sets status

- [ ] Test special targets:
  - [ ] Handoff to "complete" doesn't invoke webhook
  - [ ] Handoff to "error" sets status = failed

**Acceptance Criteria:**
- All ownership transitions tested
- previousOwner tracked correctly
- workflowStep increments
- Special targets work (complete, error)

---

#### Story 5.2: E2E Test - AISMR Happy Path

**Why:** Validate complete AISMR production flow end-to-end.

**Tasks:**

- [ ] Create `tests/e2e/aismr-happy-path.test.ts`
  - [ ] Mock Telegram message: "Make candles"
  - [ ] Mock trace_prep endpoint responses
  - [ ] Mock video generation API
  - [ ] Mock editing API
  - [ ] Mock TikTok publish API
  - [ ] Simulate full flow:
    - [ ] Casey determines project = aismr
    - [ ] Iggy generates 12 modifiers
    - [ ] Riley writes 12 screenplays
    - [ ] Veo generates 12 videos
    - [ ] Alex stitches compilation
    - [ ] Quinn publishes and notifies user
  - [ ] Verify trace status = completed
  - [ ] Verify all memories tagged with traceId
  - [ ] Verify user receives notification

**Acceptance Criteria:**
- Full AISMR flow completes successfully
- All 6 personas execute in order
- Final video URL returned
- User notified
- Test runs in < 5 minutes

---

#### Story 5.3: E2E Test - GenReact with Optional Step Skip

**Why:** Validate GenReact flow with Alex optionally skipped.

**Tasks:**

- [ ] Create `tests/e2e/genreact-optional-skip.test.ts`
  - [ ] Simulate "Make a simple generational AI video"
  - [ ] Veo decides videos are good quality (no editing needed)
  - [ ] Veo hands off directly to Quinn (skips Alex)
  - [ ] Verify workflowStep accounting
  - [ ] Verify Quinn receives videos directly

**Acceptance Criteria:**
- GenReact flow completes with 6 videos
- Alex skipped when appropriate
- Quinn publishes successfully

---

### Epic 6: Documentation & Polish

**Duration:** 2-3 days  
**Prerequisites:** Epic 5 complete  
**Goal:** Complete documentation for production readiness

#### Story 6.1: Update Core Documentation

**Why:** Docs must reflect new trace-centric architecture.

**Tasks:**

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

**Acceptance Criteria:**
- All docs reflect trace-centric architecture
- No references to old per-agent workflows
- Examples tested and accurate

---

#### Story 6.2: Create New Documentation

**Why:** New patterns need dedicated docs.

**Tasks:**

- [ ] Create `docs/TRACE_STATE_MACHINE.md`
  - [ ] Explain trace ownership model
  - [ ] Diagram state transitions
  - [ ] Document trace lifecycle
  - [ ] Include SQL queries for debugging

- [ ] Create `docs/UNIVERSAL_WORKFLOW.md`
  - [ ] Document myloware-agent.workflow.json structure
  - [ ] Explain 3-node pattern
  - [ ] Document trace_prep HTTP endpoint
  - [ ] Include troubleshooting guide

- [ ] Create `docs/ASYNC_PATTERNS.md`
  - [ ] Document toolWorkflow pattern
  - [ ] Document Wait node usage
  - [ ] Document job ledger pattern
  - [ ] Include examples from Veo/Alex

**Acceptance Criteria:**
- All 3 new docs created
- Comprehensive coverage
- Cross-referenced with existing docs

---

#### Story 6.3: Final Code Quality

**Why:** Ensure production-ready code.

**Tasks:**

- [ ] Run all quality checks:
  - [ ] `npm run lint` - no errors
  - [ ] `npm run type-check` - no errors
  - [ ] `npm run format:check` - all formatted
  - [ ] `npm run check:legacy-tools` - no forbidden tools
  - [ ] Remove console.logs
  - [ ] Remove commented code

- [ ] Run test suite:
  - [ ] `npm run test:coverage`
  - [ ] Coverage ≥ 50%
  - [ ] All tests pass
  - [ ] No skipped tests

- [ ] Documentation:
  - [ ] All code examples tested
  - [ ] No broken links
  - [ ] Consistent formatting

**Acceptance Criteria:**
- All quality checks pass
- Coverage target met
- Production-ready

---

## 🔄 Migration Path

### From Current State

```
Current:
├── ✅ Trace schema with ownership fields
├── ✅ Job ledger tables
├── ✅ MCP tools (partial)
├── ✅ Workflow skeleton
└── ❌ trace_prep endpoint (MISSING!)

Add:
├── 1. trace_prep HTTP endpoint ← START HERE
├── 2. Persona allowedTools
├── 3. Project workflow field
├── 4. Complete workflow config
├── 5. Quinn notification
├── 6. Async toolWorkflow patterns
└── 7. Tests & docs
```

### Critical Path

```
Epic 1 (Server-Side Preprocessing) ← MUST DO FIRST
  └── Story 1.1: trace_prep endpoint (BLOCKER FOR ALL ELSE)
  └── Story 1.2: Persona schema
  └── Story 1.3: Project schema
  
Epic 2 (Complete Workflow) ← THEN THIS
  └── Depends on Epic 1 completion
  
Epic 3-6 (Parallel after Epic 2)
```

---

## 🎯 Success Criteria

### MVP (Minimum Viable)

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
- [ ] Coverage ≥ 50%

---

## 🚨 Risks & Mitigations

### High Risk

**1. trace_prep endpoint complexity**
- **Risk:** Prompt assembly logic complex, many edge cases
- **Mitigation:** Start with simple templates, iterate
- **Contingency:** Fall back to n8n preprocessing nodes if endpoint too complex

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

---

## 📋 Quick Reference

### Key Files to Create

```
src/api/routes/trace-prep.ts         ← NEW (Story 1.1)
src/api/utils/prompt-builder.ts      ← NEW (Story 1.1 helper)
tests/unit/api/trace-prep.test.ts    ← NEW (Story 1.1)
tests/integration/trace-prep-endpoint.test.ts ← NEW (Story 1.1)
drizzle/0009_persona_allowed_tools.sql ← NEW (Story 1.2)
drizzle/0010_project_workflow_singular.sql ← NEW (Story 1.3)
tests/integration/trace-ownership-flow.test.ts ← NEW (Story 5.1)
tests/e2e/aismr-happy-path.test.ts   ← NEW (Story 5.2)
tests/e2e/genreact-optional-skip.test.ts ← NEW (Story 5.3)
docs/TRACE_STATE_MACHINE.md          ← NEW (Story 6.2)
docs/UNIVERSAL_WORKFLOW.md           ← NEW (Story 6.2)
docs/ASYNC_PATTERNS.md               ← NEW (Story 6.2)
```

### Key Files to Update

```
workflows/myloware-agent.workflow.json (Stories 2.1, 2.2)
src/db/schema.ts (Stories 1.2, 1.3)
data/personas/*.json (Story 1.2)
data/projects/*.json (Story 1.3)
src/mcp/tools.ts (verify handoff_to_agent, add notification)
docs/ARCHITECTURE.md (Story 6.1)
docs/MCP_TOOLS.md (Story 6.1)
docs/MCP_PROMPT_NOTES.md (Story 6.1)
```

---

## 🎓 Architectural Clarifications (vs North Star)

These decisions resolve conflicts in the North Star document:

1. **Preprocessing:** Server-side via trace_prep HTTP endpoint (not client-side n8n preprocessing)
2. **Handoff:** AI agents call handoff_to_agent tool themselves (with timeout safety net)
3. **Notification:** Quinn notifies user directly (no Casey blocking loop)
4. **Async Ops:** AI agents call toolWorkflow which handles Wait internally
5. **Discovery:** trace_prep endpoint does all context loading (agents don't call context_get_*)
6. **Project Field:** Singular `workflow` array + `optionalSteps` array

---

## 📊 Progress Tracking

### Epic Status

- [ ] **Epic 1:** Server-Side Preprocessing (3 stories) - 🔴 NOT STARTED
- [ ] **Epic 2:** Complete Universal Workflow (3 stories) - 🔴 NOT STARTED  
- [ ] **Epic 3:** Quinn Direct Notification (1 story) - 🔴 NOT STARTED
- [ ] **Epic 4:** Async Operations (2 stories) - 🔴 NOT STARTED
- [ ] **Epic 5:** Testing & Validation (3 stories) - 🔴 NOT STARTED
- [ ] **Epic 6:** Documentation & Polish (3 stories) - 🔴 NOT STARTED

**Total Stories:** 15  
**Completed:** 0  
**Blocked:** 0  
**Critical Path:** Epic 1 → Epic 2 → (Epic 3-6 parallel)

---

**Next Step:** Start with Epic 1, Story 1.1 - Create the trace_prep HTTP endpoint. This is the critical blocker for everything else.


