# North Star V2 — Sequential Agile Implementation Plan

## 📋 Product Goal

Create a multi-agent, memory-first "AI Production Studio" where Casey kicks off work, specialist agents hand off autonomously via natural-language instructions, and memory (tagged by `traceId`) is the coordination fabric.

## ⚙️ Working Agreements (Fail-First, Test-Early)

- [ ] No deprecations or fallbacks; legacy paths are removed
- [ ] Calls to removed code error loudly and immediately (build fails or hard runtime error)
- [ ] CI gates on unit/integration tests and style checks
- [ ] Pre-commit hooks run tests on affected packages and lint
- [ ] Stories carry Acceptance Criteria using Gherkin (Given/When/Then)
- [ ] Stories close only when Definition of Done is met
- [ ] Follow "As a [role], I want/need/am required to [goal], so that [benefit]" template

## 🚫 Non-Goals

- [ ] Re-platforming away from Fastify, MCP SDK, Postgres/pgvector, or n8n
- [ ] Building complex central run-state orchestration; state lives in memories + lightweight execution trace

## 🔄 Status — November 7, 2025

**Completed**

- [x] Story 1.1 (`trace_create`) is live end-to-end: schema/migrations, tool implementation, repo + MCP tests, and docs.
- [x] Agent webhook plumbing, `handoff_to_agent`, and `workflow_complete` tools exist with targeted unit + integration coverage (`tests/unit/mcp/trace-tools.test.ts`, `tests/integration/trace-coordination.test.ts`).
- [x] Test harness resilience: disposable Postgres container now auto-discovers the Docker socket, chooses a free port, and reinitializes Drizzle/pg pools; developer guide updated.

**Outstanding / In Progress**

- [ ] Documentation still missing updates for `ARCHITECTURE.md`, prompt usage examples, and n8n workflow templates.
- [ ] Epic 2 workflows (Casey → Quinn) are scoped but unimplemented; Story 2.1 is the next net-new build once Epic 1 closes.
- [ ] Legacy tool deprecation plan (Story “Legacy Tool Deprecation”) not started.
- [ ] Confirm unit-test coverage ≥ 80% after the latest green suite (`TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit` now passes as of Nov 7, 2025).

**Immediate Next Steps**

1. **Docs & Runbooks:** Finish `ARCHITECTURE.md` + MCP prompt notes updates so trace-based coordination is documented before kicking off new workflows.
2. **Coverage & Reporting:** Capture the new green `npm run test:unit` baseline (≥80% target) and wire it into CI.
3. **Legacy Cutover:** Inventory and yank deprecated MCP tools once parity is validated to prevent regression.
4. **Start Story 2.1:** After Epic 1 DoD items are fully checked, begin Casey→Iggy workflow implementation in n8n using the new trace tools.
2. **Docs & Runbooks:** Finish `ARCHITECTURE.md` + MCP prompt notes updates so trace-based coordination is documented before kicking off new workflows.
3. **Legacy Cutover:** Inventory and yank deprecated MCP tools once parity is validated to prevent regression.
4. **Start Story 2.1:** After Epic 1 DoD items are fully checked, begin Casey→Iggy workflow implementation in n8n using the new trace tools.

---

## 🎯 Epic 1 — Minimal MCP Surfaces

**Objective:** Provide the smallest viable MCP contract so agents can coordinate: `trace_create`, `handoff_to_agent`, `workflow_complete`.

### User Stories

#### Story 1.1: Casey Creates Trace ID

**As** Casey, **I need to** create a `traceId` to anchor a production run, **so that** downstream agents can discover all work by memory.

**Acceptance Criteria:**

- [x] Given an authenticated request
- [x] When `trace_create` is called with project and session parameters
- [x] Then a unique `traceId` is generated and returned
- [x] And the trace is persisted in `execution_traces` table
- [x] And the trace status is set to 'active'

**Implementation Tasks:**

- [x] Create `execution_traces` table in Drizzle schema
- [x] Add fields: `id`, `traceId`, `projectId`, `sessionId`, `status`, `createdAt`, `completedAt`
- [x] Implement `trace_create` tool in `src/mcp/tools.ts`
- [x] Add input validation for required parameters
- [x] Generate unique `traceId` (UUID v4)
- [x] Persist trace to database
- [x] Return `traceId` to caller
- [x] Write unit tests for happy path
- [x] Write unit tests for validation errors
- [x] Write unit tests for database errors

#### Story 1.2: Agent Handoff Mechanism

**As** a specialist agent, **I need to** hand off with natural instructions and get a webhook URL for the next agent, **so that** work flows autonomously.

**Acceptance Criteria:**

- [x] Given a valid `traceId` and `toAgent` name
- [x] When `handoff_to_agent` is called with instructions
- [x] Then the target agent's webhook is invoked via n8n and execution status plus metadata (including the webhook URL) is returned
- [x] And the handoff is logged to memory with `traceId`
- [x] And the instructions are passed along
- [x] And error is thrown if `toAgent` is unknown or the webhook invocation fails fast

**Implementation Tasks:**

- [x] Create `agent_webhooks` table in Drizzle schema
- [x] Add fields: `id`, `agentName`, `webhookUrl`, `description`, `isActive`
- [x] Seed table with initial agent webhooks (casey, iggy, riley, veo, alex, quinn)
- [x] Implement `handoff_to_agent` tool in `src/mcp/tools.ts`
- [x] Validate `traceId` exists and is active
- [x] Lookup agent webhook by name and load webhook configuration (URL, auth, method)
- [x] Invoke the n8n webhook and capture the execution response (status, run identifiers, any payload)
- [x] Store handoff event to memory with tags and response summary
- [x] Return webhook URL, execution status, and run identifiers to caller
- [x] Centralize webhook host/auth configuration (env or secrets manager) and document rotation steps (see `docs/n8n-webhook-config.md`)
- [x] Keep `docs/n8n-webhook-config.md` updated with auth-handling, no-versioning rationale, and execution correlation expectations
- [x] Write unit tests for successful handoff
- [x] Write unit tests for unknown agent
- [x] Write unit tests for inactive trace

#### Legacy Tool Deprecation

- [ ] Inventory existing MCP tools overlapping trace, handoff, or workflow completion responsibilities
- [ ] Flag the following tools for removal in favor of `trace_create`/`handoff_to_agent`/`workflow_complete`:
  - `run_state_createOrResume`
  - `run_state_read`
  - `run_state_update`
  - `run_state_appendEvent`
  - `handoff_create`
  - `handoff_claim`
  - `handoff_complete`
  - `handoff_listPending`
- [ ] Remove or disable deprecated tools immediately after replacements land, with hard failures on invocation
- [ ] Update documentation and runbooks to reflect removals
- [ ] Add CI guardrails preventing new references to deprecated tool names

#### Story 1.3: Workflow Completion Signal

**As** Casey, **I need** a completion signal with outputs, **so that** I can notify the user and archive the run.

**Acceptance Criteria:**

- [x] Given an active `traceId`
- [x] When `workflow_complete` is called with outputs and status
- [x] Then the trace status is updated to 'completed' or 'failed'
- [x] And the `completedAt` timestamp is set
- [x] And outputs are stored or referenced
- [x] And a completion event is logged to memory

**Implementation Tasks:**

- [x] Implement `workflow_complete` tool in `src/mcp/tools.ts`
- [x] Validate `traceId` exists
- [x] Update trace status in database
- [x] Set `completedAt` timestamp
- [x] Store outputs reference
- [x] Create completion memory entry
- [x] Write unit tests for successful completion
- [x] Write unit tests for failed completion
- [x] Write unit tests for already-completed trace

### Database Schema Tasks

- [x] Create Drizzle migration file for `execution_traces` table
- [x] Create Drizzle migration file for `agent_webhooks` table
- [x] Add indexes on `traceId` for fast lookups
- [x] Add indexes on `status` for filtering
- [x] Run migrations in local development
- [x] Verify schema with `drizzle-kit push`
- [ ] Test rollback scenarios

### MCP Tool Registration

- [x] Register `trace_create` in MCP tools list
- [x] Register `handoff_to_agent` in MCP tools list
- [x] Register `workflow_complete` in MCP tools list
- [x] Verify tools appear in `/health` endpoint
- [x] Add tool descriptions and parameter schemas
- [ ] Test tool invocation via MCP protocol

### Definition of Done

- [x] All three tools (`trace_create`, `handoff_to_agent`, `workflow_complete`) implemented
- [x] Database schema created and migrations applied
- [x] Tools registered and visible in `/health` tool list
- [x] Unit tests written for each tool (happy path + error cases)
- [ ] Test coverage ≥ 80% for new tool code _(blocked: broader unit suite currently red; see failing suites below)_
- [x] Integration test: create trace → handoff → complete
- [ ] Documentation updated in `ARCHITECTURE.md`
- [ ] MCP prompt notes updated with tool usage examples
- [ ] Code passes linting and type checks _(fails until full `npm run test:unit` stabilizes)_
- [ ] PR reviewed and approved

#### Known Failing Tests

- ✅ `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit` passed on November 7, 2025 (154 tests, 26 files). Track future regressions by re-running the same command.

### Success Metrics

- [ ] P50 tool latency ≤ 150ms measured over 100 calls
- [ ] P95 tool latency ≤ 300ms measured over 100 calls
- [ ] Error rate < 1% over 1,000 calls
- [ ] 100% of new runs have a `traceId` and a row in `execution_traces`
- [ ] All handoffs successfully resolve webhook URLs

## 🎯 Epic 2 — Split Into Persona Workflows

**Objective:** Replace monolithic agent with six focused workflows: `casey`, `iggy`, `riley`, `veo`, `alex`, `quinn`.

### User Stories

#### Story 2.1: Casey Triggers Iggy

**As** Casey, **I need to** trigger Iggy's workflow with `{traceId, project, sessionId, instructions}` and then idle, **so that** agents collaborate without central coordination.

**Acceptance Criteria:**

- [ ] Given a user request for content creation
- [ ] When Casey receives the request
- [ ] Then Casey creates a `traceId` via `trace_create`
- [ ] And Casey calls `handoff_to_agent` with `toAgent='iggy'`
- [ ] And Casey passes context: `{traceId, project, sessionId, instructions}`
- [ ] And Casey goes idle (does not poll or wait)
- [ ] And Iggy's workflow is triggered autonomously

**Implementation Tasks:**

- [ ] Create `casey.workflow.json` in n8n
- [ ] Add Telegram webhook trigger for user input
- [ ] Add AI Agent node configured with `gpt-5-nano` model
- [ ] Mount MCP tool collection to AI Agent node: `trace_create`, `handoff_to_agent`, `memory_store`, `Call n8n workflow`
- [ ] Configure AI Agent system prompt: "You are Casey, the orchestrator agent. Create a trace for the production run, then hand off to Iggy."
- [ ] AI Agent receives user instructions from Telegram trigger
- [ ] AI Agent calls `trace_create` MCP tool to generate `traceId`
- [ ] AI Agent calls `handoff_to_agent` MCP tool with `toAgent='iggy'` to get webhook info
- [ ] AI Agent calls `Call n8n workflow` MCP tool to trigger Iggy's workflow
- [ ] AI Agent calls `memory_store` MCP tool to log handoff with `traceId` tag
- [ ] End Casey's workflow (no waiting/polling)

#### Story 2.2: Iggy Generates Creative Modifiers

**As** Iggy, **I need to** generate 12 modifiers, store results, and hand off to Riley, **so that** creative direction is captured and approved quickly.

**Acceptance Criteria:**

- [ ] Given `{traceId, project, sessionId, instructions}` from Casey
- [ ] When Iggy's workflow executes
- [ ] Then Iggy generates 12 creative modifiers using AI
- [ ] And modifiers are stored to memory tagged with `traceId`
- [ ] And modifiers are formatted for human review
- [ ] And Iggy requests approval via Telegram (HITL checkpoint)
- [ ] And upon approval, Iggy hands off to Riley
- [ ] And upon decline, Iggy regenerates with feedback

**Implementation Tasks:**

- [ ] Create `iggy.workflow.json` in n8n
- [ ] Add "When Executed by Another Workflow" trigger accepting `{traceId, project, sessionId, instructions}`
- [ ] Add AI Agent node configured with `gpt-5-nano` model
- [ ] Mount MCP tool collection to AI Agent node: `memory_search`, `memory_store`, `handoff_to_agent`, `Call n8n workflow`
- [ ] Configure AI Agent system prompt: "You are Iggy, the ideation agent. Generate 12 creative modifiers, store them to memory, then hand off to Riley after approval."
- [ ] AI Agent receives `{traceId, project, sessionId, instructions}` from trigger
- [ ] AI Agent generates 12 creative modifiers using internal reasoning
- [ ] AI Agent formats modifiers as numbered list for human review
- [ ] AI Agent calls `memory_store` MCP tool to persist modifiers with `traceId` tag
- [ ] Add Telegram "Send and Wait for Approval" node (outside AI Agent)
- [ ] On approval: AI Agent calls `handoff_to_agent` MCP tool with `toAgent='riley'`
- [ ] On approval: AI Agent calls `Call n8n workflow` MCP tool to trigger Riley's workflow
- [ ] On decline: collect feedback, AI Agent regenerates with feedback context
- [ ] End workflow

#### Story 2.3: Riley Writes Scripts

**As** Riley, **I need to** write scripts from Iggy's output and hand off to Veo, **so that** production can start without waiting on Casey.

**Acceptance Criteria:**

- [ ] Given `{traceId, project, sessionId}` from Iggy
- [ ] When Riley's workflow executes
- [ ] Then Riley searches memory for modifiers by `traceId`
- [ ] And Riley generates scripts for each modifier
- [ ] And scripts are stored to memory tagged with `traceId`
- [ ] And Riley hands off to Veo with script references

**Implementation Tasks:**

- [ ] Create `riley.workflow.json` in n8n
- [ ] Add "When Executed by Another Workflow" trigger accepting `{traceId, project, sessionId}`
- [ ] Add AI Agent node configured with `gpt-5-nano` model
- [ ] Mount MCP tool collection to AI Agent node: `memory_search`, `memory_store`, `handoff_to_agent`, `Call n8n workflow`
- [ ] Configure AI Agent system prompt: "You are Riley, the screenwriter agent. Search for modifiers, write scripts for each, store them, then hand off to Veo."
- [ ] AI Agent receives `{traceId, project, sessionId}` from trigger
- [ ] AI Agent calls `memory_search` MCP tool with `traceId` filter to retrieve modifiers from Iggy
- [ ] AI Agent iterates over modifiers and generates scripts using internal reasoning
- [ ] AI Agent calls `memory_store` MCP tool for each script with `traceId` and `persona='riley'` tags
- [ ] AI Agent calls `handoff_to_agent` MCP tool with `toAgent='veo'`
- [ ] AI Agent calls `Call n8n workflow` MCP tool to trigger Veo's workflow
- [ ] End workflow

#### Story 2.4: Veo Generates Videos

**As** Veo, **I need to** generate videos and hand off to Alex, **so that** editing can proceed in parallel.

**Acceptance Criteria:**

- [ ] Given `{traceId, project, sessionId}` from Riley
- [ ] When Veo's workflow executes
- [ ] Then Veo searches memory for scripts by `traceId`
- [ ] And Veo generates videos for each script
- [ ] And video URLs are stored to memory tagged with `traceId`
- [ ] And Veo hands off to Alex with video references

**Implementation Tasks:**

- [ ] Create `veo.workflow.json` in n8n
- [ ] Add "When Executed by Another Workflow" trigger accepting `{traceId, project, sessionId}`
- [ ] Add AI Agent node configured with `gpt-5-nano` model
- [ ] Mount MCP tool collection to AI Agent node: `memory_search`, `memory_store`, `handoff_to_agent`, `Call n8n workflow`
- [ ] Add HTTP request tool for video generation API to AI Agent's tool collection
- [ ] Configure AI Agent system prompt: "You are Veo, the video generation agent. Retrieve scripts, generate videos, store URLs, then hand off to Alex."
- [ ] AI Agent receives `{traceId, project, sessionId}` from trigger
- [ ] AI Agent calls `memory_search` MCP tool with `traceId` filter to retrieve scripts from Riley
- [ ] AI Agent iterates over scripts and calls video generation API for each
- [ ] AI Agent polls for video completion (with timeout handling)
- [ ] AI Agent calls `memory_store` MCP tool for each video URL with `traceId` and `persona='veo'` tags
- [ ] AI Agent calls `handoff_to_agent` MCP tool with `toAgent='alex'`
- [ ] AI Agent calls `Call n8n workflow` MCP tool to trigger Alex's workflow
- [ ] End workflow

#### Story 2.5: Alex Stitches the Edit

**As** Alex, **I need to** stitch the edit and hand off to Quinn, **so that** final publishing is streamlined.

**Acceptance Criteria:**

- [ ] Given `{traceId, project, sessionId}` from Veo
- [ ] When Alex's workflow executes
- [ ] Then Alex searches memory for videos by `traceId`
- [ ] And Alex stitches videos together
- [ ] And final edit URL is stored to memory tagged with `traceId`
- [ ] And Alex requests final approval via Telegram (HITL checkpoint)
- [ ] And upon approval, Alex hands off to Quinn

**Implementation Tasks:**

- [ ] Create `alex.workflow.json` in n8n
- [ ] Add "When Executed by Another Workflow" trigger accepting `{traceId, project, sessionId}`
- [ ] Add AI Agent node configured with `gpt-5-nano` model
- [ ] Mount MCP tool collection to AI Agent node: `memory_search`, `memory_store`, `handoff_to_agent`, `Call n8n workflow`
- [ ] Add HTTP request tool for video editing API to AI Agent's tool collection
- [ ] Configure AI Agent system prompt: "You are Alex, the video editor agent. Retrieve videos, stitch the final edit, store it, then hand off to Quinn after approval."
- [ ] AI Agent receives `{traceId, project, sessionId}` from trigger
- [ ] AI Agent calls `memory_search` MCP tool with `traceId` filter to retrieve video URLs from Veo
- [ ] AI Agent calls video editing API/service to stitch videos together
- [ ] AI Agent calls `memory_store` MCP tool to persist final edit URL with `traceId` and `persona='alex'` tags
- [ ] Add Telegram "Send and Wait for Approval" node (outside AI Agent)
- [ ] On approval: AI Agent calls `handoff_to_agent` MCP tool with `toAgent='quinn'`
- [ ] On approval: AI Agent calls `Call n8n workflow` MCP tool to trigger Quinn's workflow
- [ ] On decline: collect feedback, AI Agent re-edits with feedback context
- [ ] End workflow

#### Story 2.6: Quinn Publishes Content

**As** Quinn, **I need to** publish and complete the workflow, **so that** the audience receives content promptly.

**Acceptance Criteria:**

- [ ] Given `{traceId, project, sessionId}` from Alex
- [ ] When Quinn's workflow executes
- [ ] Then Quinn searches memory for final edit by `traceId`
- [ ] And Quinn publishes to configured platforms (YouTube, TikTok, etc.)
- [ ] And publication URLs are stored to memory tagged with `traceId`
- [ ] And Quinn calls `workflow_complete` with outputs
- [ ] And Casey is notified of completion

**Implementation Tasks:**

- [ ] Create `quinn.workflow.json` in n8n
- [ ] Add "When Executed by Another Workflow" trigger accepting `{traceId, project, sessionId}`
- [ ] Add AI Agent node configured with `gpt-5-nano` model
- [ ] Mount MCP tool collection to AI Agent node: `memory_search`, `memory_store`, `workflow_complete`
- [ ] Add HTTP request tools for publishing platform APIs (YouTube, TikTok, etc.) to AI Agent's tool collection
- [ ] Configure AI Agent system prompt: "You are Quinn, the publisher agent. Retrieve the final edit, publish to platforms, store publication URLs, mark workflow complete, and notify Casey."
- [ ] AI Agent receives `{traceId, project, sessionId}` from trigger
- [ ] AI Agent calls `memory_search` MCP tool with `traceId` filter to retrieve final edit from Alex
- [ ] AI Agent calls platform APIs to publish content (YouTube, TikTok, etc.)
- [ ] AI Agent calls `memory_store` MCP tool to persist publication URLs with `traceId` and `persona='quinn'` tags
- [ ] AI Agent calls `workflow_complete` MCP tool with success status and output URLs
- [ ] AI Agent sends notification to Casey/user via Telegram
- [ ] End workflow

### Workflow Infrastructure Tasks

- [ ] Create n8n AI Agent workflow template with standard parameters
- [ ] Ensure all workflows accept: `{traceId, project, sessionId, instructions}`
- [ ] Configure all workflows with AI Agent node + MCP tool collection pattern
- [ ] Ensure MCP server exposes `Call n8n workflow` tool for agent-to-agent triggers
- [ ] Configure workflow webhooks in `agent_webhooks` table
- [ ] Test workflow-to-workflow execution via `Call n8n workflow` MCP tool
- [ ] Implement error handling and retry logic within AI Agent nodes
- [ ] Add timeout configurations for each workflow
- [ ] Configure logging for workflow starts/completions
- [ ] Verify AI Agent tool bindings are correct for each persona
- [ ] Test that MCP tools are accessible from within AI Agent nodes (not as standalone nodes)

### Definition of Done

- [ ] All six workflows created (`casey`, `iggy`, `riley`, `veo`, `alex`, `quinn`)
- [ ] Each workflow centers on a single AI Agent node configured with `gpt-5-nano` model
- [ ] All workflows use "When Executed by Another Workflow" trigger
- [ ] All workflows parameterized for `{traceId, project, sessionId, instructions}`
- [ ] MCP tool collection mounted to each AI Agent node (not standalone nodes)
- [ ] All handoffs use `Call n8n workflow` MCP tool (called by AI Agent)
- [ ] Manual end-to-end test succeeds for AISMR (candles topic)
- [ ] AI Agents successfully call MCP tools: `trace_create`, `handoff_to_agent`, `memory_store`, `memory_search`, `workflow_complete`
- [ ] No central coordinator in the flow (Casey idles after trigger)
- [ ] Memory searches work correctly by `traceId` filter
- [ ] Workflows tested individually and in sequence
- [ ] Error paths tested (API failures, timeouts)
- [ ] Documentation updated with AI Agent architecture pattern

### Success Metrics

- [ ] > 90% of end-to-end runs complete without Casey intervening mid-flow
- [ ] Average stage duration reported to Prometheus
- [ ] Per-stage p95 duration tracked: Iggy < 3min, Riley < 5min, Veo < 15min, Alex < 10min, Quinn < 5min
- [ ] Memory retrieval precision ≥ 95% for `traceId` searches
- [ ] Zero handoff failures due to missing webhooks

## 🎯 Epic 3 — Memory Discipline & Retrieval

**Objective:** Make memory the single source of truth for coordination.

### User Stories

#### Story 3.1: Enforce Memory Tagging with traceId

**As** an agent, **I am required to** write a single-line episodic memory tagged with `{traceId, persona, project, tags, relatedTo}` after each meaningful step, **so that** the execution graph is reconstructable.

**Acceptance Criteria:**

- [ ] Given any agent performing a meaningful step
- [ ] When the agent stores a memory
- [ ] Then `traceId` appears in the memory metadata
- [ ] And the memory content is a single line (no newlines)
- [ ] And `persona` field identifies the agent
- [ ] And `project` field identifies the project context
- [ ] And optional `tags` and `relatedTo` fields support graph linking

**Implementation Tasks:**

- [ ] Create helper wrapper `createTracedMemory(traceId, persona, content, metadata)` in `src/tools/memory/`
- [ ] Add validation to ensure `traceId` is present in metadata
- [ ] Add validation to enforce single-line content (no `\n` chars)
- [ ] Throw error if `traceId` or `persona` is missing
- [ ] Update all agent workflows to use the helper
- [ ] Write unit tests for the wrapper
- [ ] Write validation tests for edge cases

#### Story 3.2: Search and Retrieve by traceId

**As** an agent, **I need to** find prior outputs via `memory_search` filtered by `traceId`, **so that** I can proceed without Casey.

**Acceptance Criteria:**

- [ ] Given a valid `traceId`
- [ ] When `memory_search` is called with `traceId` filter
- [ ] Then the last N memories matching that trace are returned
- [ ] And memories are sorted in reverse chronological order (newest first)
- [ ] And retrieval precision ≥ 95% for test fixtures

**Implementation Tasks:**

- [ ] Enhance `memory_search` to support `traceId` filter parameter
- [ ] Add index on `metadata->traceId` for fast lookups
- [ ] Ensure results are sorted by `createdAt DESC`
- [ ] Implement pagination for large result sets
- [ ] Write unit tests for traceId filtering
- [ ] Write integration tests with realistic memory chains
- [ ] Benchmark query performance (p95 < 100ms)

### Validation & Enforcement Tasks

- [ ] Add linting rule or ESLint plugin to detect direct `memory_store` calls (should use wrapper)
- [ ] Create checklist for agent workflow reviews
- [ ] Document memory tagging standards in `ARCHITECTURE.md`
- [ ] Add pre-commit hook to check for proper memory usage patterns

### Definition of Done

- [ ] Helper wrapper `createTracedMemory` implemented and tested
- [ ] All existing agent workflows updated to use wrapper
- [ ] Validation enforces `traceId` presence and single-line content
- [ ] `memory_search` supports `traceId` filtering
- [ ] Database index added for performance
- [ ] Integration test demonstrates full trace reconstruction
- [ ] Linting or checklist prevents direct `memory_store` usage
- [ ] Documentation updated with examples

### Success Metrics

- [ ] 100% of new memories include `traceId` (monitored via DB queries)
- [ ] Retrieval precision for last-hop context ≥ 95% in test runs
- [ ] Memory search latency p95 < 100ms
- [ ] Zero validation errors in production after 100 runs

## 🎯 Epic 4 — Replace Mismatched REST Calls

**Objective:** Remove references to non-existent `/api/*` endpoints from n8n flows.

### User Stories

#### Story 4.1: Remove Invalid API References

**As** Veo/Alex/Quinn, **my workflow uses** MCP tools or direct provider HTTP nodes only, **so that** there are no 404 errors during execution.

**Acceptance Criteria:**

- [ ] Given any workflow in `workflows/` directory
- [ ] When searching for `/api/videos` or `/api/workflow-runs`
- [ ] Then zero matches are found
- [ ] And all workflows use valid MCP tools or external provider APIs
- [ ] And no 404 errors occur during E2E runs

**Implementation Tasks:**

- [ ] Audit all n8n workflow files for `/api/*` references
- [ ] Identify each invalid endpoint and its intended purpose
- [ ] Replace `/api/videos` calls with proper video generation API calls
- [ ] Replace `/api/workflow-runs` calls with `memory_search` or other MCP tools
- [ ] Update HTTP node configurations to use correct endpoints
- [ ] Test each modified workflow individually
- [ ] Run full E2E test to verify no 404s

### CI/CD Guardrails

- [ ] Add CI grep check for `/api/videos` pattern in `workflows/`
- [ ] Add CI grep check for `/api/workflow-runs` pattern in `workflows/`
- [ ] Configure CI to fail build if patterns are found
- [ ] Add to `.github/workflows/` or equivalent CI config
- [ ] Test CI check by intentionally introducing forbidden pattern
- [ ] Verify CI fails and provides helpful error message

### Definition of Done

- [ ] Grep for `/api/videos` returns 0 matches in `workflows/`
- [ ] Grep for `/api/workflow-runs` returns 0 matches in `workflows/`
- [ ] E2E test run produces no server 404 errors
- [ ] CI job configured to fail on forbidden patterns
- [ ] CI check tested and working
- [ ] Documentation updated with correct API patterns

### Success Metrics

- [ ] 0 runtime 404s from the MCP server during standard runs
- [ ] 0 invalid API references in codebase
- [ ] CI prevents reintroduction of invalid patterns

## 🎯 Epic 5 — HITL Checkpoints (n8n)

**Objective:** Use Telegram "Send and Wait" nodes at natural checkpoints.

### User Stories

#### Story 5.1: Iggy Modifier Approval

**As** Iggy, **I need to** request approval for the 12 modifiers, **so that** creative direction is validated before scripts are written.

**Acceptance Criteria:**

- [ ] Given Iggy has generated 12 modifiers
- [ ] When the approval node executes
- [ ] Then a Telegram message is sent with the modifiers
- [ ] And the workflow pauses waiting for approval
- [ ] And approve/decline buttons are presented
- [ ] And timeout is set to 15 minutes
- [ ] And approval proceeds to handoff
- [ ] And decline loops back with feedback request

**Implementation Tasks:**

- [ ] Add Telegram "Send and Wait for Approval" node to `iggy.workflow.json`
- [ ] Format modifiers as readable numbered list
- [ ] Configure approve button with label "Approve Modifiers"
- [ ] Configure decline button with label "Request Changes"
- [ ] Set timeout to 15 minutes
- [ ] On approval: proceed to Riley handoff
- [ ] On decline: add feedback collection node
- [ ] On decline: loop back to modifier generation with feedback
- [ ] Test approval flow
- [ ] Test decline flow

#### Story 5.2: Alex Final Cut Approval

**As** Alex, **I need to** request final cut approval before publish, **so that** the edited video is reviewed before going live.

**Acceptance Criteria:**

- [ ] Given Alex has stitched the final edit
- [ ] When the approval node executes
- [ ] Then a Telegram message is sent with the video preview/link
- [ ] And the workflow pauses waiting for approval
- [ ] And approve/publish buttons are presented
- [ ] And timeout is set to 30 minutes
- [ ] And approval proceeds to Quinn handoff
- [ ] And decline loops back with feedback for re-edit

**Implementation Tasks:**

- [ ] Add Telegram "Send and Wait for Approval" node to `alex.workflow.json`
- [ ] Include video preview link in message
- [ ] Configure approve button with label "Approve & Publish"
- [ ] Configure decline button with label "Request Re-edit"
- [ ] Set timeout to 30 minutes
- [ ] On approval: proceed to Quinn handoff
- [ ] On decline: add feedback collection node
- [ ] On decline: loop back to editing with feedback
- [ ] Test approval flow
- [ ] Test decline flow with actual video

### Telegram Configuration Tasks

- [ ] Configure Telegram bot token in n8n credentials
- [ ] Set up chat ID for approval messages
- [ ] Test message delivery
- [ ] Test button interactions
- [ ] Configure timeout behaviors
- [ ] Add error handling for Telegram API failures

### Definition of Done

- [ ] Telegram nodes configured in Iggy and Alex workflows
- [ ] Clear, actionable copy for approval requests
- [ ] Timeouts configured (Iggy: 15min, Alex: 30min)
- [ ] Approve paths proceed to next agent
- [ ] Decline paths collect feedback and loop back
- [ ] Both flows tested manually with real Telegram interaction
- [ ] Error handling for timeout and API failures

### Success Metrics

- [ ] Median approval turnaround < 2 minutes in staging
- [ ] < 10% decline-and-retry loops per run
- [ ] 100% of approval requests delivered successfully
- [ ] Zero timeout-related workflow failures

## 🎯 Epic 6 — Hard Removal & Fail-First Guardrails

**Objective:** Eliminate legacy code and paths; break fast on misuse.

### User Stories

#### Story 6.1: Remove Legacy Tools from Codebase

**As** a developer, **I need** legacy tools (`run_state_*`, `handoff_*`, `prompt_discover`, `clarify_ask`) physically removed from code and workflows, **so that** no one can accidentally use them.

**Acceptance Criteria:**

- [ ] Given the legacy tool list
- [ ] When searching the codebase
- [ ] Then zero implementations of removed tools exist
- [ ] And zero exports of removed tools exist
- [ ] And the MCP server no longer registers them
- [ ] And all workflows reference only new tools

**Legacy Tools to Remove:**

- [x] `run_state_create`
- [x] `run_state_update`
- [x] `run_state_get`
- [x] `handoff_request` (old version, replaced by `handoff_to_agent`)
- [ ] `prompt_discover`
- [ ] `clarify_ask`

**Implementation Tasks:**

- [x] Search codebase for `run_state_create` and delete implementations
- [x] Search codebase for `run_state_update` and delete implementations
- [x] Search codebase for `run_state_get` and delete implementations
- [x] Search codebase for old `handoff_request` and delete implementations
- [ ] Search codebase for `prompt_discover` and delete implementations
- [ ] Search codebase for `clarify_ask` and delete implementations
- [x] Remove tool registrations from `src/mcp/tools.ts`
- [x] Delete tool implementation files
- [ ] Remove exports from index files
- [ ] Search workflows for legacy tool references and remove
- [x] Update any tests that reference legacy tools
- [ ] Verify server starts without registering removed tools

#### Story 6.2: CI Checks for Removed Symbols

**As** a CI system, **I need** checks that fail the build when removed symbols or endpoints are referenced, **so that** errors surface early.

**Acceptance Criteria:**

- [ ] Given a commit that references a removed tool
- [ ] When CI runs
- [ ] Then the build fails
- [ ] And an error message explains the removed tool
- [ ] And a remediation hint points to the new tool

**Implementation Tasks:**

- [ ] Add CI grep check for `run_state_create` pattern
- [ ] Add CI grep check for `run_state_update` pattern
- [ ] Add CI grep check for `run_state_get` pattern
- [ ] Add CI grep check for old `handoff_request` pattern
- [ ] Add CI grep check for `prompt_discover` pattern
- [ ] Add CI grep check for `clarify_ask` pattern
- [ ] Create CI script that runs all forbidden pattern checks
- [ ] Add script to GitHub Actions or equivalent CI pipeline
- [ ] Include remediation hints in error messages
- [ ] Test by intentionally introducing forbidden pattern
- [ ] Verify CI fails with helpful error message

#### Story 6.3: Runtime Fail-Fast on Removed Endpoints

**As** the MCP server, **I need to** return explicit errors when removed routes or tools are called, **so that** errors are loud and immediately visible.

**Acceptance Criteria:**

- [ ] Given a request to a removed endpoint
- [ ] When the server receives the request
- [ ] Then a 410 Gone or 404 with explicit error is returned
- [ ] And the error message explains the tool was removed
- [ ] And a remediation hint is provided
- [ ] And the error is logged with severity WARNING or ERROR

**Implementation Tasks:**

- [ ] Add explicit 410 Gone handlers for removed HTTP endpoints
- [ ] Include error message: "This tool has been removed in favor of [new_tool]"
- [ ] Add remediation hints to response body
- [ ] Ensure errors are logged with context
- [ ] Test each removed endpoint returns proper error
- [ ] Verify error messages are clear and actionable

### TypeScript Safety Tasks

- [ ] Remove type definitions for legacy tools
- [ ] Update imports that reference removed types
- [ ] Run TypeScript compiler to catch remaining references
- [ ] Fix any type errors
- [ ] Ensure build passes

### Definition of Done

- [ ] All legacy tool code physically deleted
- [ ] All tool exports removed
- [ ] Server no longer registers removed tools
- [ ] CI grep rules configured for all forbidden patterns
- [ ] TypeScript build fails if removed symbols referenced
- [ ] Runtime returns 410 Gone with helpful errors for removed endpoints
- [ ] All checks tested and working
- [ ] Zero references to removed tools in repo
- [ ] Documentation updated to reflect removed tools

### Success Metrics

- [ ] 0 references to removed tools in repository
- [ ] 0 runtime calls to removed tools in E2E tests
- [ ] CI successfully prevents merge when patterns reappear
- [ ] 100% of removed endpoint calls return explicit errors

## 🎯 Epic 7 — Testing & Observability

**Objective:** Confidence and visibility through comprehensive testing and monitoring.

### User Stories

#### Story 7.1: Comprehensive Test Coverage

**As** an engineer, **I need to** run unit tests for MCP tools and integration tests for memory discipline, **so that** I have confidence in system behavior.

**Acceptance Criteria:**

- [ ] Given new MCP tools
- [ ] When I run the test suite
- [ ] Then unit tests cover ≥ 80% of MCP tool code
- [ ] And integration tests validate memory discipline
- [ ] And contract tests validate tool schemas
- [ ] And pre-commit hooks run affected tests

**Implementation Tasks:**

- [ ] Write unit tests for `trace_create` tool (happy path + errors)
- [ ] Write unit tests for `handoff_to_agent` tool (happy path + errors)
- [ ] Write unit tests for `workflow_complete` tool (happy path + errors)
- [ ] Write integration test for full trace flow (create → handoff → complete)
- [ ] Write integration test for memory tagging with `traceId`
- [ ] Write integration test for memory search by `traceId`
- [ ] Write contract tests validating MCP tool schemas
- [ ] Write contract tests validating error response codes
- [ ] Configure Vitest coverage reporting
- [ ] Set coverage threshold to 80% for `src/mcp/` directory
- [ ] Configure pre-commit hook to run affected tests
- [ ] Optimize test suite for < 90s runtime locally

#### Story 7.2: Observability and Metrics

**As** an operator, **I need to** see metrics for tools, stage durations, and errors, **so that** I can monitor system health and performance.

**Acceptance Criteria:**

- [ ] Given the MCP server is running
- [ ] When I access `/metrics` endpoint
- [ ] Then Prometheus metrics are exposed
- [ ] And tool duration metrics are available
- [ ] And tool error rate metrics are available
- [ ] And stage duration metrics are available
- [ ] And system health metrics are available

**Implementation Tasks:**

- [ ] Add Prometheus client library to dependencies
- [ ] Create `/metrics` endpoint in server
- [ ] Add histogram metric for tool durations (`mcp_tool_duration_seconds`)
- [ ] Add counter metric for tool calls (`mcp_tool_calls_total`)
- [ ] Add counter metric for tool errors (`mcp_tool_errors_total`)
- [ ] Add histogram metric for stage durations (`agent_stage_duration_seconds`)
- [ ] Add gauge metric for active traces (`active_traces_count`)
- [ ] Label metrics by tool name, agent name, status
- [ ] Test metrics collection locally
- [ ] Create sample Grafana dashboard JSON
- [ ] Include panels for: tool latency (p50, p95), error rates, stage durations, active traces
- [ ] Save dashboard to `docs/grafana-dashboard.json`
- [ ] Document metrics in `docs/OBSERVABILITY.md`

### Test Infrastructure Tasks

- [ ] Configure Vitest for unit and integration tests
- [ ] Set up test database for integration tests
- [ ] Create test fixtures for memory and trace data
- [ ] Add test helpers for common setup/teardown
- [ ] Configure CI to run full test suite
- [ ] Set up test coverage reporting in CI
- [ ] Fail CI build if coverage drops below 80%

### Pre-Commit Hook Tasks

- [ ] Install Husky or similar pre-commit framework
- [ ] Configure hook to run affected tests (not full suite)
- [ ] Add linting to pre-commit checks
- [ ] Add TypeScript type checking to pre-commit
- [ ] Test hook with intentional test failure
- [ ] Document how to bypass hooks (for emergencies only)

### Definition of Done

- [ ] Vitest coverage ≥ 80% for MCP tools directory
- [ ] Pre-commit hooks run affected tests automatically
- [ ] Contract tests validate MCP tool schemas and error codes
- [ ] Prometheus metrics exported at `/metrics`
- [ ] Sample Grafana dashboard JSON in `docs/`
- [ ] Test suite runs in < 90s locally
- [ ] All tests pass in CI
- [ ] Documentation updated with testing and observability guides

### Success Metrics

- [ ] p95 tool latency stable over 1,000 runs
- [ ] Test suite completes in < 90s locally
- [ ] Test coverage ≥ 80% maintained
- [ ] Zero flaky tests in CI

## 🎯 Epic 8 — Security & Ops Hardening

**Objective:** Keep transport secure and resilient for MCP streaming.

### User Stories

#### Story 8.1: Security Middleware Configuration

**As** an operator, **I need to** configure Helmet/CORS/Rate-limit appropriately, **so that** the MCP server is secure and resilient.

**Acceptance Criteria:**

- [ ] Given the MCP server is running
- [ ] When security middleware is configured
- [ ] Then Helmet security headers are applied
- [ ] And CORS is configured for allowed origins only
- [ ] And rate limiting is enforced per API key
- [ ] And secrets are redacted from logs
- [ ] And health checks work correctly

**Implementation Tasks:**

- [ ] Install Helmet middleware for Fastify
- [ ] Configure Helmet with appropriate security headers
- [ ] Install and configure CORS plugin
- [ ] Define allowed origins for CORS (environment variable)
- [ ] Install rate limiting plugin (e.g., `@fastify/rate-limit`)
- [ ] Configure rate limits: 100 requests/minute per API key
- [ ] Key rate limiter by `x-api-key` header
- [ ] Add log redaction for sensitive fields (API keys, tokens)
- [ ] Test rate limiting with burst requests
- [ ] Test CORS with allowed and disallowed origins
- [ ] Verify logs do not contain secrets

#### Story 8.2: Health Checks and Monitoring

**As** an operator, **I need** health checks that show system status, **so that** I can monitor service health.

**Acceptance Criteria:**

- [ ] Given the MCP server is running
- [ ] When I access `/health` endpoint
- [ ] Then the response shows overall status
- [ ] And OpenAI client status is checked
- [ ] And database connection status is checked
- [ ] And response is returned within 1 second
- [ ] And unhealthy status returns 503 Service Unavailable

**Implementation Tasks:**

- [ ] Create `/health` endpoint in server
- [ ] Check OpenAI API connectivity (or cache last result)
- [ ] Check database connectivity with simple query
- [ ] Return JSON: `{ status: "ok", openai: "ok", database: "ok", timestamp: "..." }`
- [ ] Return 200 OK when all systems healthy
- [ ] Return 503 Service Unavailable when any system unhealthy
- [ ] Add timeout to health checks (max 1 second)
- [ ] Cache health check results for 30 seconds
- [ ] Test health endpoint under various failure scenarios
- [ ] Document health check format

### Logging and Secret Management Tasks

- [ ] Review all log statements for sensitive data
- [ ] Implement log redaction utility
- [ ] Redact `x-api-key` header values
- [ ] Redact OpenAI API keys
- [ ] Redact database passwords
- [ ] Redact Telegram bot tokens
- [ ] Use environment variables for all secrets
- [ ] Document required environment variables
- [ ] Add example `.env.example` file

### Definition of Done

- [ ] Helmet security headers configured and tested
- [ ] CORS configured with appropriate allowed origins
- [ ] Rate limiting enforced and keyed by API key
- [ ] Logs redact all sensitive information
- [ ] `/health` endpoint shows `openai=ok`, `database=ok` in steady state
- [ ] Health checks respond within 1 second
- [ ] Unhealthy state returns 503
- [ ] All secrets managed via environment variables
- [ ] Documentation updated with security configuration

### Success Metrics

- [ ] 0 unauthorized requests accepted
- [ ] Rate limits successfully block excessive requests
- [ ] Health checks return within 1s consistently
- [ ] Zero secrets leaked in logs (audit review)

## 🎯 Epic 9 — Data Model Migrations

**Objective:** Introduce new tables and indexes without downtime.

### User Stories

#### Story 9.1: Create and Apply Database Migrations

**As** a DBA, **I need to** apply Drizzle migrations for `execution_traces` and `agent_webhooks`, **so that** the new tables support the trace-based coordination model.

**Acceptance Criteria:**

- [ ] Given the new schema definitions
- [ ] When migrations are generated and applied
- [ ] Then `execution_traces` table exists with correct columns
- [ ] And `agent_webhooks` table exists with correct columns
- [ ] And indexes are created for optimal query performance
- [ ] And migrations can be rolled back if needed
- [ ] And old tables remain intact (no data loss)

**Implementation Tasks:**

- [ ] Define `execution_traces` table in Drizzle schema
- [ ] Add columns: `id`, `traceId` (UUID, unique), `projectId`, `sessionId`, `status`, `createdAt`, `completedAt`, `metadata` (JSONB)
- [ ] Define `agent_webhooks` table in Drizzle schema
- [ ] Add columns: `id`, `agentName` (unique), `webhookUrl`, `description`, `isActive`, `createdAt`, `updatedAt`
- [ ] Add index on `execution_traces.traceId` for fast lookups
- [ ] Add index on `execution_traces.status` for filtering
- [ ] Add index on `execution_traces.createdAt` for time-based queries
- [ ] Add index on `agent_webhooks.agentName` for lookups
- [ ] Generate migration with `drizzle-kit generate`
- [ ] Review generated SQL migration file
- [ ] Test migration in local development
- [ ] Test rollback migration
- [ ] Apply migration to staging environment
- [ ] Verify tables and indexes exist
- [ ] Run query performance tests

### Seed Data Tasks

- [ ] Create seed script for `agent_webhooks` table
- [ ] Add entry for Casey agent
- [ ] Add entry for Iggy agent
- [ ] Add entry for Riley agent
- [ ] Add entry for Veo agent
- [ ] Add entry for Alex agent
- [ ] Add entry for Quinn agent
- [ ] Set appropriate webhook URLs (environment-based)
- [ ] Mark all agents as active
- [ ] Run seed script in development
- [ ] Run seed script in staging

### Migration Safety Tasks

- [ ] Ensure migrations are additive only (no destructive changes)
- [ ] Keep old tables intact until cutover complete
- [ ] Document rollback procedure
- [ ] Test migration with realistic data volume
- [ ] Verify no application downtime during migration
- [ ] Plan for zero-downtime deployment

### Definition of Done

- [ ] Drizzle schema definitions created for both tables
- [ ] Migrations generated via `drizzle-kit`
- [ ] Migrations reviewed for correctness and safety
- [ ] Migrations applied successfully in staging
- [ ] Indexes created and verified
- [ ] Seed data loaded for agent webhooks
- [ ] Query performance benchmarks meet targets
- [ ] Rollback tested successfully
- [ ] Documentation updated with migration guide
- [ ] Backfill not required (new system starts fresh)

### Success Metrics

- [ ] Query p95 for trace lookups < 50ms
- [ ] Index size reasonable for expected dataset (< 1GB for 1M traces)
- [ ] Zero downtime during migration
- [ ] All indexes used correctly by query planner (EXPLAIN ANALYZE)

## 🎯 Epic 10 — Rollout & Enablement

**Objective:** Smooth cutover and team adoption with comprehensive documentation.

### User Stories

#### Story 10.1: Documentation and Runbooks

**As** a stakeholder, **I can** read a 1-page runbook and run an AISMR demo end-to-end, **so that** I understand the system and can operate it.

**Acceptance Criteria:**

- [ ] Given the documentation in `docs/`
- [ ] When I read the runbook
- [ ] Then I understand how to start the system
- [ ] And I can run an end-to-end AISMR demo
- [ ] And I know how to troubleshoot common issues
- [ ] And I have a checklist for production readiness

**Implementation Tasks:**

- [ ] Create `docs/RUNBOOK.md` with step-by-step guide
- [ ] Document system startup procedure
- [ ] Document how to trigger Casey via Telegram
- [ ] Document AISMR demo flow (candles example)
- [ ] Document how to monitor traces
- [ ] Document how to check workflow status
- [ ] Create `docs/TROUBLESHOOTING.md`
- [ ] Add common errors and solutions
- [ ] Add debugging tips for each agent
- [ ] Add database query examples for trace inspection
- [ ] Create `docs/PRODUCTION_CHECKLIST.md`
- [ ] Include environment variable checklist
- [ ] Include security checklist
- [ ] Include monitoring checklist
- [ ] Include backup and recovery procedures
- [ ] Update `README.md` with quick start
- [ ] Add architecture diagram to docs

#### Story 10.2: Staging Cutover and Production Readiness

**As** an operator, **I need** to complete staging cutover and prepare production toggle, **so that** we can deploy safely.

**Acceptance Criteria:**

- [ ] Given the staging environment
- [ ] When the new system is deployed
- [ ] Then all six agent workflows are active
- [ ] And migrations are applied
- [ ] And agent webhooks are configured
- [ ] And monitoring is enabled
- [ ] And a feature toggle allows production rollout

**Implementation Tasks:**

- [ ] Deploy MCP server to staging
- [ ] Apply database migrations in staging
- [ ] Deploy all six n8n workflows to staging
- [ ] Configure agent webhook URLs in staging
- [ ] Seed agent_webhooks table in staging
- [ ] Configure Telegram bot for staging
- [ ] Run full end-to-end test in staging (AISMR candles)
- [ ] Verify all handoffs work correctly
- [ ] Verify memory search by traceId works
- [ ] Verify HITL approvals work
- [ ] Monitor metrics during staging test
- [ ] Add feature toggle for production (environment variable)
- [ ] Document rollback procedure
- [ ] Prepare deployment plan for production
- [ ] Schedule production deployment window

### Training and Enablement Tasks

- [ ] Create demo video showing end-to-end flow
- [ ] Walk through runbook with stakeholders
- [ ] Demo troubleshooting guide
- [ ] Review metrics dashboard with operations team
- [ ] Document escalation procedures
- [ ] Share access to staging environment

### Definition of Done

- [ ] Runbook completed and reviewed in `docs/RUNBOOK.md`
- [ ] Troubleshooting guide completed in `docs/TROUBLESHOOTING.md`
- [ ] Production checklist completed in `docs/PRODUCTION_CHECKLIST.md`
- [ ] README updated with quick start guide
- [ ] Staging cutover completed successfully
- [ ] End-to-end demo works in staging
- [ ] Feature toggle ready for production
- [ ] Rollback procedure documented and tested
- [ ] Team trained on new system
- [ ] Production deployment scheduled

### Success Metrics

- [ ] First production run completes end-to-end with zero manual rework between agents
- [ ] Stakeholders can run demo without assistance
- [ ] < 5 minutes to complete runbook steps
- [ ] Zero critical issues in first 48 hours of production

---

## 🎯 Milestones

### Milestone 1 (Week 1): Foundation - MCP Tools + Database Schema

**Epic 1 (Minimal MCP Surfaces) + Epic 9 (Data Model Migrations)**

**Goals:**

- [ ] MCP tools (`trace_create`, `handoff_to_agent`, `workflow_complete`) implemented
- [ ] Database schema created and migrations applied
- [ ] Unit tests written and passing
- [ ] Tools registered and visible in `/health`

**Exit Criteria:**

- [ ] All Epic 1 and Epic 9 Definition of Done items completed
- [ ] Unit test coverage ≥ 80% for new tools
- [ ] Database migrations applied in dev and staging
- [x] Integration test: create trace → handoff → complete passes

**Deliverables:**

- [ ] Working MCP tools
- [ ] Database tables: `execution_traces`, `agent_webhooks`
- [ ] Seed data for agent webhooks
- [ ] Test suite with unit tests

---

### Milestone 2 (Week 2): Agent Workflows + Memory Coordination

**Epic 2 (Split Into Persona Workflows) + Epic 3 (Memory Discipline & Retrieval)**

**Goals:**

- [ ] Six agent workflows created in n8n
- [ ] Memory helper wrapper implemented
- [ ] Workflow-to-workflow handoffs working
- [ ] Memory search by `traceId` functional
- [ ] One full end-to-end test passing

**Exit Criteria:**

- [ ] All Epic 2 and Epic 3 Definition of Done items completed
- [ ] Manual E2E demo succeeds for AISMR (candles)
- [ ] Memory retrieval precision ≥ 95%
- [ ] All handoffs autonomous (no manual intervention)

**Deliverables:**

- [ ] Six n8n workflows: Casey, Iggy, Riley, Veo, Alex, Quinn
- [ ] Memory wrapper: `createTracedMemory`
- [ ] Enhanced `memory_search` with `traceId` filter
- [ ] E2E test results and metrics

---

### Milestone 3 (Week 3): Cleanup + HITL + Observability

**Epic 4 (Replace Mismatched REST Calls) + Epic 5 (HITL Checkpoints) + Epic 7 (Testing & Observability)**

**Goals:**

- [ ] Invalid API references removed
- [ ] HITL approval nodes configured
- [ ] Comprehensive test coverage achieved
- [ ] Prometheus metrics exposed
- [ ] Grafana dashboard created

**Exit Criteria:**

- [ ] All Epic 4, 5, and 7 Definition of Done items completed
- [ ] Zero 404 errors in E2E runs
- [ ] HITL approvals tested and working
- [ ] Test coverage ≥ 80% for MCP tools
- [ ] Metrics available at `/metrics`

**Deliverables:**

- [ ] Clean workflows (no invalid API calls)
- [ ] Telegram approval nodes in Iggy and Alex workflows
- [ ] Full test suite with >80% coverage
- [ ] Prometheus metrics endpoint
- [ ] Grafana dashboard JSON in `docs/`

---

### Milestone 4 (Week 4): Hardening + Deprecations + Production Rollout

**Epic 6 (Hard Removal & Fail-First Guardrails) + Epic 8 (Security & Ops Hardening) + Epic 10 (Rollout & Enablement)**

**Goals:**

- [ ] Legacy tools removed from codebase
- [ ] CI guardrails preventing regressions
- [ ] Security middleware configured
- [ ] Health checks working
- [ ] Documentation complete
- [ ] Staging cutover successful
- [ ] Production ready

**Exit Criteria:**

- [ ] All Epic 6, 8, and 10 Definition of Done items completed
- [ ] Zero references to removed tools
- [ ] CI prevents forbidden patterns
- [ ] Security audit passed
- [ ] Runbooks complete
- [ ] Staging E2E successful
- [ ] Production deployment plan approved

**Deliverables:**

- [ ] Clean codebase (no legacy tools)
- [ ] CI checks for forbidden patterns
- [ ] Secured MCP server (Helmet, CORS, rate limits)
- [ ] Complete documentation suite
- [ ] Production deployment checklist
- [ ] Rollback procedure

---

## ✅ Program-Level Acceptance Criteria

### End-to-End Demo Scenario

**Given** a user wants to create AISMR content  
**When** the user asks Casey (via Telegram): "Make an AISMR video about candles"  
**Then** the following occurs autonomously:

1. **Casey** receives request and creates `traceId`
   - [ ] Trace created and persisted in database
   - [ ] Casey hands off to Iggy
   - [ ] Casey goes idle (no polling)

2. **Iggy** generates creative modifiers
   - [ ] 12 modifiers generated
   - [ ] Modifiers stored to memory with `traceId`
   - [ ] HITL approval requested via Telegram
   - [ ] Upon approval, hands off to Riley

3. **Riley** writes scripts
   - [ ] Searches memory for modifiers by `traceId`
   - [ ] Generates scripts for each modifier
   - [ ] Scripts stored to memory with `traceId`
   - [ ] Hands off to Veo

4. **Veo** generates videos
   - [ ] Searches memory for scripts by `traceId`
   - [ ] Generates videos for each script
   - [ ] Video URLs stored to memory with `traceId`
   - [ ] Hands off to Alex

5. **Alex** stitches the edit
   - [ ] Searches memory for videos by `traceId`
   - [ ] Stitches final edit
   - [ ] Final edit URL stored to memory with `traceId`
   - [ ] HITL approval requested via Telegram
   - [ ] Upon approval, hands off to Quinn

6. **Quinn** publishes content
   - [ ] Searches memory for final edit by `traceId`
   - [ ] Publishes to platforms
   - [ ] Publication URLs stored to memory with `traceId`
   - [ ] Calls `workflow_complete`
   - [ ] Notifies Casey

7. **Verification**
   - [ ] All agent outputs discoverable via `memory_search({traceId})`
   - [ ] Casey notifies user with final URL
   - [ ] Metrics show healthy latencies
   - [ ] > 90% autonomous handoffs (no manual intervention)
   - [ ] Both HITL approvals completed
   - [ ] End-to-end completion within p95 target

---

## 📊 Success Dashboard (Top-Line Metrics)

### System Health Metrics

- [ ] **Autonomous Handoffs Rate** ≥ 90% per run
  - _Measure: Percentage of handoffs that complete without manual intervention_
- [ ] **End-to-End Lead Time** ≤ 20 min p95 (AISMR baseline)
  - _Measure: Time from user request to final publication_
- [ ] **Memory Tag Compliance** = 100%
  - _Measure: Percentage of new memories that include `traceId`_
- [ ] **Incident Rate** ≤ 1 per 50 runs (excluding provider outages)
  - _Measure: System errors requiring manual intervention_

### Quality Metrics

- [ ] **Test Coverage** ≥ 80% for MCP tools
- [ ] **API Error Rate** < 1% (non-404s)
- [ ] **Memory Retrieval Precision** ≥ 95%
- [ ] **HITL Approval Turnaround** < 2 min median

### Performance Metrics

- [ ] **MCP Tool Latency** p95 < 300ms
- [ ] **Memory Search Latency** p95 < 100ms
- [ ] **Trace Lookup Latency** p95 < 50ms
- [ ] **Health Check Response** < 1s consistently

### Operational Metrics

- [ ] **Deployment Success Rate** 100% (with rollback capability)
- [ ] **Documentation Completeness** 100% (runbook + troubleshooting)
- [ ] **Security Audit** Pass (no secrets in logs, rate limits enforced)
- [ ] **CI/CD Pipeline Health** All checks passing

---

## 🎉 Definition of Program Success

**The program is successful when:**

1. ✅ A user can trigger Casey via Telegram with a simple request
2. ✅ The system autonomously coordinates across 6 agents
3. ✅ All coordination happens via memory tagged with `traceId`
4. ✅ No manual intervention required except HITL approvals
5. ✅ Full execution trace is reconstructable from memory
6. ✅ Metrics demonstrate healthy performance and reliability
7. ✅ Documentation enables team to operate and troubleshoot
8. ✅ Production runs complete end-to-end with published content

---

**Ready to start? Begin with Milestone 1 → Epic 1 → Story 1.1!** 🚀

## Implementation Notes

- 2025-11-06: Rebuilt dev Postgres by tearing down Docker volumes, binding the container to host port 6543, and updating config normalization logic so local scripts rewrite `postgres` → `localhost`.
- 2025-11-06: Ran `drizzle-kit push` against the fresh database and `npm run db:seed` to load personas/projects/workflows plus the new `agent_webhooks` directory (Casey → Quinn).
- 2025-11-06: Confirmed `/health` reports `status":"healthy` both inside Docker and via `https://mcp-vector.mjames.dev/health`, covering database, OpenAI, and MCP tool registration checks.
- 2025-11-06: Added dedicated Vitest DB bootstrap (`npm run db:setup:test`), `TEST_DB_URL`-first harness behavior, and `test:unit:local`/`test:unit:container` shortcuts so local runs avoid Testcontainers unless explicitly requested.
