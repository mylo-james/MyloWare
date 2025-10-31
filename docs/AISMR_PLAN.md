# AISMR 2.0: MCP-Native Workflow Transformation Plan

**Date:** October 31, 2025  
**Based On:** MCP system analysis + existing AISMR workflow review  
**Goal:** Transform static AISMR prompts and workflows into adaptive MCP-native system  
**Timeline:** 6 weeks (3 phases)

---

## Executive Summary

This plan transforms AISMR from rigid JSON-based prompts and stateless workflows into an intelligent, adaptive content generation system that leverages our advanced MCP capabilities: hybrid search, memory routing, episodic memory, graph traversal, and adaptive retrieval.

**Current State:** Static prompts, no uniqueness checking, no learning from history, rigid output schemas  
**Target State:** Dynamic context retrieval, session-based uniqueness, graph-based pattern discovery, iterative refinement, conversation memory

---

## Current Architecture Analysis

### What Works

✅ n8n AI Agent nodes handle OpenAI interactions  
✅ MCP Client tool connects to our MCP server  
✅ Structured Output Parser enforces schemas  
✅ Workflow orchestration (parent → child flows)

### Critical Issues

❌ **No uniqueness checking** - Generates duplicate ideas within sessions  
❌ **Static prompts** - Hardcoded instructions don't adapt to context  
❌ **No learning** - Can't recall past successful videos or quality issues  
❌ **Rigid schemas** - Forces exact JSON structure, brittle to changes  
❌ **No error handling** - Infinite loops on failures (per REVIEW.md)  
❌ **State management bugs** - Parent workflows overwrite child results

### MCP Capabilities Not Yet Leveraged

⚠️ `conversation.remember` - Session-based uniqueness checking  
⚠️ `prompts.search` with `expandGraph` - Discovering related successful concepts  
⚠️ `prompts_search_adaptive` - Iterative creative refinement  
⚠️ Memory routing - Automatic context injection  
⚠️ Temporal boosting - Prioritizing recent quality guidelines  
⚠️ Graph traversal - Finding semantic connections between concepts

---

## Phase 1: Foundation - Memory System & Prompts (Weeks 1-2)

### Epic 1.1: Memory Ingestion & Classification

**Goal:** Seed the MCP memory system with AISMR knowledge, specifications, and history.

#### Story 1.1.1: Classify and Ingest AISMR Specifications

**As a** system administrator  
**I want to** load all AISMR rules and specifications into the MCP memory system  
**So that** agents can retrieve them dynamically instead of relying on hardcoded prompts

**Acceptance Criteria:**

- [x] Create `prompts/memory/aismr-specifications.json` with structured specs:
  - Sacred timing rules (3.0s whisper, 8.0s runtime)
  - Format constraints (9:16 vertical, single shot)
  - Hand discipline rules (max 2 hands)
  - Audio rules (no music during generation)
  - Cinematography guidelines
- [x] Tag each specification with `memoryType: "procedural"` and `project: "aismr"`
- [x] Ingest via `npm run ingest:prompts`
- [x] Verify searchable via keyword search:
  ```bash
  curl -X POST http://localhost:3000/mcp/prompts.search \
    -d '{"query": "whisper timing 3.0 seconds", "searchMode": "keyword", "project": "aismr"}'
  ```
- [x] Confirm returns exact specification chunks

**Files to create:**

- `prompts/memory/aismr-specifications.json`

---

#### Story 1.1.2: Ingest AISMR DNA and Creative Philosophy

**As a** content creator  
**I want** AISMR's creative DNA stored as project memory  
**So that** agents automatically inject brand principles into every generation

**Acceptance Criteria:**

- [x] Create `prompts/memory/aismr-dna.json`:
  - Core philosophy: "Impossible yet filmable surrealism"
  - Sensory principles: "Tactile, hypnotic, high replay value"
  - Format DNA: "8s micro-films, single shot, whisper at 3.0s"
  - Anti-patterns: "No cuts, no music, max 2 hands"
- [x] Tag with `memoryType: "project"`, `project: "aismr"`
- [x] Ingest and verify retrievable via:
  ```typescript
  prompts.search({
    query: 'AISMR creative philosophy',
    project: 'aismr',
    searchMode: 'vector',
    useMemoryRouting: true,
  });
  ```
- [x] Confirm memory router prioritizes project memory for brand queries

**Files to create:**

- `prompts/memory/aismr-dna.json`

---

#### Story 1.1.3: Archive Existing Successful Videos

**As a** creative strategist  
**I want** past successful AISMR videos stored with concept + performance metadata  
**So that** the system can learn from what works and discover patterns via graph expansion

**Acceptance Criteria:**

- [x] Extract all completed videos from `runs` table with status `'completed'`
- [x] Create memory entries:
  ```typescript
  {
    chunk_id: "video_{videoId}",
    chunk_text: "{concept} - {vibe} - {screenplay_excerpt}",
    metadata: {
      type: "video_execution",
      concept: "Glowing Crystal",
      vibe: "ethereal hypnotic",
      environment: "underwater cave",
      timestamp: "2025-10-15T...",
      performance_notes: "High replay value, 3.2s avg watch time"
    },
    memory_type: "semantic",
    project: "aismr"
  }
  ```
- [x] Ingest via script: `npm run aismr:archive-videos`
- [x] Verify graph links created between similar concepts (e.g., "Glowing Crystal" ↔ "Iridescent Gem")
- [x] Test retrieval with graph expansion:
  ```typescript
  prompts.search({
    query: 'crystal concepts',
    project: 'aismr',
    expandGraph: true,
    maxHops: 2,
  });
  ```

**Files to create:**

- `scripts/archiveAismrVideos.ts`

**Exit Criteria:** videos archived, retrievable via semantic search + graph

> Note: Local dev dataset currently contains a single completed AISMR video; archival script and graph wiring verified against that sample and is ready to scale once additional completions exist.

---

### Epic 1.2: Persona Prompt Transformation

**Goal:** Rewrite persona prompts to leverage MCP tools instead of static instructions.

#### Story 1.2.1: Rewrite Idea Generator Persona (MCP-Native)

**As an** AI agent orchestrator  
**I want** the idea generator persona to use MCP tools for uniqueness checking and inspiration  
**So that** it generates truly unique concepts informed by past patterns

**Acceptance Criteria:**

- [x] Create `prompts/v2/persona-ideagenerator.json` with:
  - Tool usage instructions for `conversation.remember` (session uniqueness)
  - Tool usage instructions for `prompts.search` (archive uniqueness, pattern discovery)
  - Tool usage instructions for `prompts_search_adaptive` (creative inspiration)
  - Workflow steps: check session → check archive → explore patterns → generate → validate
- [x] Remove hardcoded "call prompt_get twice" instructions
- [x] Add anti-patterns section:
  - "NEVER generate without checking conversation.remember first"
  - "NEVER skip graph expansion when looking for similar concepts"
- [x] Document expected tool call sequence
- [x] Ingest with `memoryType: "persona"`, `personaId: "ideagenerator"`

**Files to create:**

- `prompts/v2/persona-ideagenerator.json`

**Exit Criteria:** Persona prompt loaded via `prompt_get`, instructs agent to use 4+ MCP tools

---

#### Story 1.2.2: Rewrite Screenwriter Persona (MCP-Native)

**As an** AI agent orchestrator  
**I want** the screenwriter persona to load specifications dynamically and learn from past issues  
**So that** it generates screenplays that honor sacred rules and avoid known failures

**Acceptance Criteria:**

- [x] Create `prompts/v2/persona-screenwriter.json` with:
  - Tool usage for loading sacred specs via keyword search
  - Tool usage for finding similar successful scripts via graph expansion
  - Tool usage for checking quality issues via `conversation.remember`
  - Tool usage for style refinement via `prompts_search_adaptive`
  - Validation checklist: whisper timing, hand count, music ban, runtime
- [x] Add critical validation step with HALT on failure
- [x] Document parallel tool calls for efficiency (load 4 specs in parallel)
- [x] Ingest with `memoryType: "persona"`, `personaId: "screenwriter"`

**Files to create:**

- `prompts/v2/persona-screenwriter.json`

**Exit Criteria:** Persona prompt enforces validation, uses 5+ MCP tools for context

---

### Epic 1.3: Project Prompt Transformation

**Goal:** Transform project prompt into MCP integration guide.

#### Story 1.3.1: Rewrite AISMR Project Prompt

**As an** AI agent orchestrator  
**I want** the AISMR project prompt to document MCP integration patterns  
**So that** any persona working on AISMR knows how to use memory tools correctly

**Acceptance Criteria:**

- [x] Create `prompts/v2/project-aismr.json` with:
  - **Uniqueness Enforcement Strategy**: document 3-layer checking
    1. Session uniqueness via `conversation.remember` (fastest)
    2. Archive uniqueness via `prompts.search` (comprehensive)
    3. Iterative refinement via `prompts_search_adaptive` (uncertain cases)
  - **Specification Loading Strategy**: keyword search for exact rules
  - **Quality Monitoring Strategy**: episodic memory for known issues
  - **Performance Patterns**: graph traversal for discovering winners
  - **Workflow Templates**: document tool call sequences for idea gen + screenwriting
- [x] Add anti-patterns section with critical violations
- [x] Include example tool call configurations with parameters
- [x] Ingest with `memoryType: "project"`, `project: "aismr"`

**Files to create:**

- `prompts/v2/project-aismr.json`

**Exit Criteria:** Project prompt documents MCP integration, searchable by agents

---

### Epic 1.4: Combination Prompt Transformation

**Goal:** Create executable workflow prompts that combine persona + project + MCP tools.

#### Story 1.4.1: Rewrite Idea Generator × AISMR Combination

**As an** AI agent  
**I want** a complete workflow prompt for AISMR idea generation  
**So that** I know exactly which MCP tools to call and in what order

**Acceptance Criteria:**

- [x] Create `prompts/v2/ideagenerator-aismr.json` with:
  - 8-step workflow (session check → archive check → specs → inspiration → graph → generate → validate → store)
  - Detailed tool parameters for each step
  - Expected inputs: `userInput`, `sessionId`, `runId`
  - Expected outputs: JSON schema with 12 ideas
  - Critical path identification (which steps cannot be skipped)
  - Execution context (estimated duration, tools used)
- [x] Document parallel tool calls where possible
- [x] Add validation logic for uniqueness cross-check
- [x] Include conversation.store metadata structure
- [x] Ingest with `memoryType: "semantic"`, tags: `["workflow", "aismr", "ideagenerator"]`

**Files to create:**

- `prompts/v2/ideagenerator-aismr.json`

**Exit Criteria:** Workflow prompt is executable, agents can follow step-by-step

---

#### Story 1.4.2: Rewrite Screenwriter × AISMR Combination

**As an** AI agent  
**I want** a complete workflow prompt for AISMR screenplay generation  
**So that** I load all specs, check quality issues, and generate validated scripts

**Acceptance Criteria:**

- [x] Create `prompts/v2/screenwriter-aismr.json` with:
  - 7-step workflow (load specs → check issues → find success → research style → write → validate → store)
  - Parallel spec loading (4 specs in parallel: timing, hands, audio, format)
  - Sacred specification validation checklist with error messages
  - Graph expansion parameters for discovering similar scripts
  - Adaptive search usage for style refinement
  - Conversation.store metadata with quality metrics
- [x] Add HALT logic on validation failure
- [x] Document expected duration (20-40s)
- [x] Include hop count and link strength parameters for graph search
- [x] Ingest with `memoryType: "semantic"`, tags: `["workflow", "aismr", "screenwriter"]`

**Files to create:**

- `prompts/v2/screenwriter-aismr.json`

**Exit Criteria:** Workflow prompt includes validation, agents follow strict quality checks

---

## Phase 2: Workflow Transformation (Weeks 3-4)

### Epic 2.1: Update Mylo MCP Bot System Prompt

**Goal:** Transform the universal AI Agent orchestrator to leverage all MCP capabilities.

#### Story 2.1.1: Enhance Mylo MCP Bot with MCP Tool Documentation

**As an** AI agent (OpenAI)  
**I want** complete documentation of all 6 MCP tools in my system prompt  
**So that** I know when and how to use each tool effectively

**Acceptance Criteria:**

- [x] Update `workflows/mylo-mcp-bot.workflow.json` system prompt with:
  - **Tool 1:** `prompt_get` - purpose, parameters, usage examples
  - **Tool 2:** `prompts.search` - all parameters documented:
    - `searchMode`: "vector" | "keyword" | "hybrid"
    - `useMemoryRouting`: true (auto-route to memory components)
    - `expandGraph`: true (traverse semantic links)
    - `maxHops`: 2 (graph depth)
    - `temporalBoost`: true (prioritize recent)
  - **Tool 3:** `prompts_search_adaptive` - iterative retrieval with utility evaluation
  - **Tool 4:** `conversation.remember` - episodic memory search with sessionId
  - **Tool 5:** `conversation.store` - auto-handled after response
  - Usage examples for each tool
  - When to use which tool (decision tree)
- [x] Add "Execution Strategy" section:
  - Phase 1: Load configuration (prompt_get)
  - Phase 2: Context enrichment (depends on task type)
  - Phase 3: Execute task
  - Phase 4: Validate & format
- [x] Document task-specific patterns:
  - **For Idea Generation**: 4 tool calls (remember → search archive → adaptive inspiration → graph exploration)
  - **For Screenwriting**: 5 tool calls (4 parallel spec loads → remember issues → search success → adaptive style)
- [x] Add key principles section:
  - Always pass sessionId
  - Always filter by project: "aismr"
  - Use keyword mode for exact specs
  - Use graph expansion for pattern discovery

**Files to modify:**

- `workflows/mylo-mcp-bot.workflow.json`

**Exit Criteria:** System prompt is 2-3x longer, documents all tools comprehensively

---

#### Story 2.1.2: Add Error Handling and Fallback Logic to System Prompt

**As an** AI agent  
**I want** clear instructions for handling tool failures  
**So that** I can gracefully degrade instead of failing completely

**Acceptance Criteria:**

- [x] Add "Error Handling" section to system prompt:
  - If tool fails, log failure clearly
  - Attempt fallback (simpler search mode)
  - If critical tool fails (conversation.remember for uniqueness), HALT and report
  - Never proceed with incomplete context for AISMR workflows
- [x] Document critical vs. optional tools
- [x] Add timeout expectations (30s max for adaptive search)
- [x] Define partial result handling

**Files to modify:**

- `workflows/mylo-mcp-bot.workflow.json`

**Exit Criteria:** Agents have clear fallback strategies documented

---

### Epic 2.2: Rewrite AISMR Main Orchestrator

**Goal:** Simplify main orchestrator, delegate intelligence to Mylo MCP Bot.

#### Story 2.2.1: Simplify AISMR Main Workflow

**As a** workflow designer  
**I want** the main AISMR workflow to focus on orchestration only  
**So that** intelligence lives in reusable Mylo MCP Bot, not duplicated logic

**Acceptance Criteria:**

- [x] Update `workflows/aismr.workflow.json`:
  - Remove hardcoded system prompt instructions
  - Keep workflow structure: Trigger → Normalize → Store Turn → Call Bot → Validate → Store Turn → Return
  - Pass through: `personaId: "ideagenerator"`, `projectId: "aismr"`, `chatInput`, `sessionId`, `outputSchema`
  - Let Mylo MCP Bot handle all tool orchestration
- [x] Ensure sessionId is generated at start and passed to all nodes
- [x] Add error handling: catch bot failures, return friendly error message
- [x] Update output validation to check schema compliance
- [x] Remove manual prompt assembly logic

**Files to modify:**

- `workflows/aismr.workflow.json`

**Exit Criteria:** Main workflow is <50 lines, delegates to Mylo MCP Bot

---

### Epic 2.3: Rewrite Generate Ideas Workflow

**Goal:** Enable session-based uniqueness checking and graph-based inspiration.

#### Story 2.3.1: Add Session Context to Generate Ideas

**As a** content creator  
**I want** idea generation to check session history  
**So that** I never get duplicate ideas within a single conversation

**Acceptance Criteria:**

- [ ] Update `workflows/generate-ideas.workflow.json`:
  - Ensure sessionId passed to Mylo MCP Bot call
  - Mylo MCP Bot system prompt will handle:
    - `conversation.remember` for session uniqueness
    - `prompts.search` for archive uniqueness
    - `prompts_search_adaptive` for creative inspiration
    - `prompts.search` with `expandGraph: true` for pattern discovery
  - No manual tool calls in workflow (bot handles it)
- [ ] After ideas generated, validate uniqueness before DB insert
- [ ] Add duplicate detection: search existing ideas by similarity > 0.85
- [ ] If duplicates found, flag for review (don't auto-reject)
- [ ] Keep existing logic: split 12 ideas into individual database rows with status `'idea_gen'`

**Files to modify:**

- `workflows/generate-ideas.workflow.json`

**Exit Criteria:** Ideas checked against session + archive, graph expansion discovers patterns

---

#### Story 2.3.2: Add Uniqueness Validation Before Database Insert

**As a** quality controller  
**I want** final uniqueness check before storing ideas  
**So that** even if agent misses duplicates, workflow catches them

**Acceptance Criteria:**

- [ ] Add validation step after Mylo MCP Bot returns ideas
- [ ] For each idea, call MCP search:
  ```typescript
  prompts.search({
    query: idea.idea,
    project: 'aismr',
    searchMode: 'hybrid',
    limit: 5,
    minSimilarity: 0.85,
  });
  ```
- [ ] If similarity > 0.85 found, flag idea as `potential_duplicate`
- [ ] Store flagged ideas with metadata: `{duplicate_check: "flagged", similar_to: [chunk_ids]}`
- [ ] Log flagged duplicates for manual review
- [ ] Continue with non-flagged ideas

**Files to modify:**

- `workflows/generate-ideas.workflow.json`

**Exit Criteria:** Duplicates flagged before DB insert, manual review enabled

---

### Epic 2.4: Rewrite Screen Writer Workflow

**Goal:** Load specifications dynamically, learn from past quality issues.

#### Story 2.4.1: Enable Dynamic Specification Loading

**As a** screenwriter agent  
**I want** to load AISMR specifications from memory  
**So that** I always use the latest rules without hardcoded prompts

**Acceptance Criteria:**

- [ ] Update `workflows/screen-writer.workflow.json`:
  - Pass video/concept context to Mylo MCP Bot
  - Bot system prompt will handle:
    - 4 parallel keyword searches for specs (timing, hands, audio, format)
    - `conversation.remember` for quality issues
    - `prompts.search` with `expandGraph: true` for similar successful scripts
    - `prompts_search_adaptive` for style refinement
  - No manual spec loading in workflow
- [ ] After screenplay generated, validate sacred specifications:
  - Whisper at exactly 3.0s
  - Max 2 hands
  - No music mentioned
  - Runtime 8.0s
  - Format 9:16 vertical
- [ ] If validation fails, HALT and return error (don't store invalid screenplay)
- [ ] Update database with generated prompt only after validation passes

**Files to modify:**

- `workflows/screen-writer.workflow.json`

**Exit Criteria:** Specifications loaded dynamically, validation enforced

---

#### Story 2.4.2: Add Quality Issue Learning

**As a** screenwriter agent  
**I want** to check past quality issues before generating  
**So that** I avoid repeating known problems (timing drift, hand violations, etc.)

**Acceptance Criteria:**

- [ ] Mylo MCP Bot system prompt already documents quality issue checking via `conversation.remember`
- [ ] After screenplay generation, store quality metadata:
  ```typescript
  conversation.store({
    role: 'assistant',
    content: generatedScreenplay,
    sessionId: sessionId,
    metadata: {
      tags: ['screenplay', 'aismr', 'completed'],
      quality_metrics: {
        whisperTiming: 3.0,
        handCount: 2,
        musicUsed: false,
        runtime: 8.0,
        aspectRatio: '9:16',
      },
      concept: idea,
      environment: extractedEnvironment,
    },
  });
  ```
- [ ] Enable future queries like: `conversation.remember({query: "timing drift issues"})`
- [ ] Test retrieval: generate a bad screenplay manually, store with issue, verify future queries surface it

**Files to modify:**

- `workflows/screen-writer.workflow.json`

**Exit Criteria:** Quality issues stored in episodic memory, retrievable for learning

---

### Epic 2.5: Improve Video Generation Orchestration

**Goal:** Fix state management bugs, add error handling.

#### Story 2.5.1: Fix Parent Workflow Overwriting Child Results (REVIEW.md Issue)

**As a** workflow engineer  
**I want** parent workflows to READ child results, not overwrite them  
**So that** actual video URLs are preserved, not replaced with metadata

**Acceptance Criteria:**

- [ ] Audit `workflows/generate-video.workflow.json` (or similar orchestrator)
- [ ] Identify where parent workflow updates `runs.result`
- [ ] Change logic to:
  - Parent: CREATE run with status `'pending'`
  - Child: UPDATE run with video URL + status `'completed'`
  - Parent: READ run status, aggregate results
  - Parent: NEVER overwrite `runs.result` after child completes
- [ ] Add test: generate video, verify final `runs.result` contains video URL, not metadata object
- [ ] Add status tracking: `pending` → `processing` → `completed` / `failed`

**Files to modify:**

- Identify actual orchestration workflow (search for Veo/video generation calls)

**Exit Criteria:** Video URLs preserved, parent reads child results correctly

---

#### Story 2.5.2: Add Error Handling and Circuit Breaker

**As a** reliability engineer  
**I want** video generation to handle failures gracefully  
**So that** one failure doesn't block the entire batch

**Acceptance Criteria:**

- [ ] Add error handling to video generation loop:
  - Try generating video
  - On failure: retry with exponential backoff (max 3 retries)
  - After 3 failures: mark as `'failed'`, continue with next video
  - Store failure reason in `runs.metadata.error`
- [ ] Add circuit breaker:
  - If 5+ consecutive failures, pause batch
  - Alert operator
  - Wait for manual intervention
- [ ] Update parent workflow to:
  - Count: successes, failures, pending
  - Report partial success: "8/12 videos generated successfully"
  - Store failure summary for analysis
- [ ] Store failures in episodic memory for learning:
  ```typescript
  conversation.store({
    role: 'system',
    content: `Video generation failed: ${error.message}`,
    metadata: {
      tags: ['video_failure', 'aismr'],
      concept: idea,
      error_type: error.code,
      retry_count: 3,
    },
  });
  ```

**Files to modify:**

- Video generation orchestration workflow

**Exit Criteria:** Failures handled gracefully, partial batches succeed, failures logged for learning

---

## Phase 3: Testing, Optimization & Documentation (Weeks 5-6)

### Epic 3.1: Integration Testing

**Goal:** Validate end-to-end AISMR 2.0 workflows with real MCP system.

#### Story 3.1.1: Test Session Uniqueness Enforcement

**As a** QA engineer  
**I want** to verify session uniqueness works end-to-end  
**So that** users never get duplicate ideas within a session

**Test Plan:**

- [ ] Start new session, generate ideas for "glass"
- [ ] In same session, generate ideas for "glass" again
- [ ] **Expected:** Second batch completely avoids first batch concepts
- [ ] Verify via: check `conversation.remember` was called with sessionId
- [ ] Verify via: check returned ideas have 0 semantic overlap (similarity < 0.7)
- [ ] Test edge case: partial overlap (e.g., "glass bottle" vs "crystal bottle")

**Exit Criteria:** Zero duplicates within session across 10 test runs

---

#### Story 3.1.2: Test Graph Traversal Discovery

**As a** QA engineer  
**I want** to verify graph expansion discovers related concepts  
**So that** agents learn from semantic connections

**Test Plan:**

- [ ] Archive test videos: "Glowing Stone" and "Iridescent Gem" (manually link if needed)
- [ ] Generate ideas for "magical crystals"
- [ ] **Expected:** System finds both via graph expansion (expandGraph: true, maxHops: 2)
- [ ] Verify via: check tool call logs show `expandGraph: true`
- [ ] Verify via: check results include both seed concepts via graph path
- [ ] Test with unrelated concept: verify graph doesn't over-expand

**Exit Criteria:** Graph expansion discovers 3+ related concepts in test scenarios

---

#### Story 3.1.3: Test Quality Issue Avoidance

**As a** QA engineer  
**I want** to verify screenwriter learns from past issues  
**So that** known problems (timing drift, hand violations) are avoided

**Test Plan:**

- [ ] Manually store quality issue in episodic memory:
  ```typescript
  conversation.store({
    role: 'system',
    content: 'Timing drift detected: whisper at 3.2s instead of 3.0s',
    metadata: { tags: ['quality_issue', 'timing_drift'] },
  });
  ```
- [ ] Generate screenplay for new concept
- [ ] **Expected:** Agent calls `conversation.remember({query: "timing drift quality issues"})`
- [ ] **Expected:** Generated screenplay explicitly validates whisper at 3.0s
- [ ] Verify via: check screenplay includes "At exactly 3.0s" (not "around 3s")
- [ ] Verify via: check validation step passes timing check

**Exit Criteria:** Screenwriter queries quality issues before generating, validation passes

---

#### Story 3.1.4: Test Adaptive Search Iteration

**As a** QA engineer  
**I want** to verify adaptive search refines queries iteratively  
**So that** complex creative requests get better results

**Test Plan:**

- [ ] Send complex request: "steampunk animals in zero gravity with tactile textures"
- [ ] **Expected:** System uses `prompts_search_adaptive` with maxIterations: 3
- [ ] Verify via: check tool call logs show 2-3 iterations
- [ ] Verify via: check utility scores improve across iterations
- [ ] Verify via: final results more relevant than single-shot search
- [ ] Test simple request: "glass concepts" (should NOT iterate, utility high immediately)

**Exit Criteria:** Adaptive search iterates on complex queries, skips on simple ones

---

### Epic 3.2: Performance Validation

**Goal:** Ensure AISMR 2.0 meets performance targets.

#### Story 3.2.1: Benchmark Idea Generation Latency

**As a** performance engineer  
**I want** to measure end-to-end idea generation time  
**So that** we meet the <30s target

**Test Plan:**

- [ ] Run 20 idea generation requests with different inputs
- [ ] Measure: total duration from trigger to response
- [ ] Break down by phase:
  - Context retrieval (conversation.remember + prompts.search): < 5s
  - Creative inspiration (prompts_search_adaptive): < 10s
  - Generation (OpenAI): < 10s
  - Validation + storage: < 5s
- [ ] **Target:** P95 < 30s
- [ ] If target missed, optimize:
  - Parallelize tool calls where possible
  - Cache frequently accessed specs
  - Reduce adaptive search iterations

**Exit Criteria:** P95 latency < 30s, P50 < 20s

---

#### Story 3.2.2: Benchmark Screenplay Generation Latency

**As a** performance engineer  
**I want** to measure screenplay generation time  
**So that** we meet the <45s target

**Test Plan:**

- [ ] Run 20 screenplay generation requests
- [ ] Break down by phase:
  - Parallel spec loading (4 keyword searches): < 3s
  - Quality issue check (conversation.remember): < 2s
  - Similar script search (with graph expansion): < 5s
  - Adaptive style research: < 10s
  - Generation (OpenAI): < 15s
  - Validation + storage: < 5s
- [ ] **Target:** P95 < 45s
- [ ] If target missed, optimize parallel calls

**Exit Criteria:** P95 latency < 45s, P50 < 30s

---

### Epic 3.3: Documentation & Training

**Goal:** Document AISMR 2.0 for users and future maintainers.

#### Story 3.3.1: Create AISMR 2.0 User Guide

**As a** content creator  
**I want** comprehensive documentation of AISMR 2.0 capabilities  
**So that** I understand how to use the new system effectively

**Acceptance Criteria:**

- [ ] Create `docs/AISMR_V2_GUIDE.md` with:
  - Overview of AISMR 2.0 architecture
  - How session uniqueness works
  - How to interpret graph-expanded results
  - How to provide feedback that improves quality
  - Troubleshooting guide (what to do if duplicates occur)
  - Examples of good vs. bad prompts
- [ ] Include screenshots from n8n workflows
- [ ] Add FAQ section

**Files to create:**

- `docs/AISMR_V2_GUIDE.md`

---

#### Story 3.3.2: Create Migration Guide from v1 to v2

**As a** system administrator  
**I want** a migration guide for transitioning from old AISMR to v2  
**So that** we can deploy without breaking existing workflows

**Acceptance Criteria:**

- [ ] Create `docs/AISMR_V2_MIGRATION.md` with:
  - Overview of breaking changes
  - Prompt migration steps (v1 → v2)
  - Workflow migration steps
  - Data migration (archive existing videos)
  - Rollback procedure
  - Testing checklist before cutover
- [ ] Document feature parity matrix (what's new, what's removed)
- [ ] Include timeline recommendation (shadow testing period)

**Files to create:**

- `docs/AISMR_V2_MIGRATION.md`

---

#### Story 3.3.3: Document MCP Tool Usage Patterns for AISMR

**As a** future maintainer  
**I want** documented patterns for how AISMR uses MCP tools  
**So that** I can troubleshoot issues and add new features

**Acceptance Criteria:**

- [ ] Create `docs/AISMR_MCP_PATTERNS.md` with:
  - Uniqueness checking pattern (3-layer approach)
  - Specification loading pattern (parallel keyword searches)
  - Pattern discovery pattern (graph expansion + temporal boost)
  - Quality learning pattern (episodic memory storage + retrieval)
  - Error handling pattern (fallbacks, retries, circuit breakers)
- [ ] Include tool call examples with parameters
- [ ] Add decision tree: when to use which tool
- [ ] Document common pitfalls and solutions

**Files to create:**

- `docs/AISMR_MCP_PATTERNS.md`

---

### Epic 3.4: Production Deployment

**Goal:** Deploy AISMR 2.0 to production with zero downtime.

#### Story 3.4.1: Shadow Testing (Week 5)

**As a** reliability engineer  
**I want** to run v1 and v2 in parallel  
**So that** I can compare outputs and catch issues before cutover

**Acceptance Criteria:**

- [ ] Deploy v2 workflows to separate n8n namespace
- [ ] Route 10% of traffic to v2 via feature flag
- [ ] Compare outputs:
  - Uniqueness: v2 should have fewer duplicates
  - Quality: v2 screenplays should pass validation more often
  - Latency: v2 should meet performance targets
- [ ] Monitor error rates (v2 should be ≤ v1)
- [ ] Collect user feedback (if applicable)
- [ ] Run for 1 week minimum

**Exit Criteria:** v2 performance ≥ v1, error rate ≤ v1, zero critical bugs

---

#### Story 3.4.2: Cutover to v2 (Week 6)

**As a** system administrator  
**I want** to switch production to AISMR 2.0  
**So that** all users benefit from new capabilities

**Acceptance Criteria:**

- [ ] Increase v2 traffic to 50% (monitor for 24h)
- [ ] If no issues, increase to 100%
- [ ] Keep v1 workflows available for rollback (don't delete)
- [ ] Update default workflow references to v2
- [ ] Archive v1 prompts in `prompts/archive/v1/`
- [ ] Monitor for 48 hours post-cutover
- [ ] Document any issues in incident log

**Rollback Plan:**

- [ ] Feature flag: instant revert to v1
- [ ] v1 workflows still deployed
- [ ] v2 prompts don't break v1 (separate namespace)

**Exit Criteria:** 100% traffic on v2, zero critical incidents in 48h

---

## Success Metrics

### Quality Metrics

- [ ] **Zero duplicates within session** - 100% elimination
- [ ] **<5% duplicates across archive** - Down from unknown baseline
- [ ] **100% screenplay validation pass rate** - All sacred rules enforced
- [ ] **80% quality issue avoidance** - Known problems don't repeat

### Performance Metrics

- [ ] **Idea generation P95 < 30s** - Meets target
- [ ] **Screenplay generation P95 < 45s** - Meets target
- [ ] **Graph expansion overhead < 5s** - Acceptable latency increase
- [ ] **Adaptive search iterations ≤ 3** - Efficient refinement

### Intelligence Metrics

- [ ] **Graph expansion discovers 20%+ more patterns** - vs. vector-only
- [ ] **Adaptive search utility scores > 0.7** - High-quality results
- [ ] **Memory routing accuracy > 90%** - Correct component selection
- [ ] **Quality learning effectiveness** - Measurable reduction in repeated issues

---

## Risk Management

### High Risk Items

1. **Session state management** - sessionId must persist across all calls
   - Mitigation: Add sessionId validation, log all transitions
2. **Graph expansion latency** - Could slow down all searches
   - Mitigation: Aggressive timeouts (5s max), limit maxHops to 2
3. **Adaptive search cost** - Multiple LLM calls per query
   - Mitigation: Cache utility evaluations, limit iterations to 3
4. **Memory pollution** - Incorrect ingestion could corrupt knowledge base
   - Mitigation: Dry-run ingestion, manual review before production

### Rollback Plan

- [ ] Keep v1 workflows deployed (separate namespace)
- [ ] Feature flag for instant v1 revert
- [ ] v2 prompts in separate directory (don't overwrite v1)
- [ ] Database changes backward-compatible (new columns, no drops)

---

## Timeline Summary

| Phase                     | Duration  | Key Deliverables                                      |
| ------------------------- | --------- | ----------------------------------------------------- |
| Phase 1: Memory & Prompts | Weeks 1-2 | Ingest specs/DNA/archive, rewrite all prompts         |
| Phase 2: Workflows        | Weeks 3-4 | Update bot prompt, transform all workflows            |
| Phase 3: Testing & Deploy | Weeks 5-6 | Integration tests, shadow testing, production cutover |

**Total Duration:** 6 weeks  
**Team Size:** 2 developers + 1 QA  
**Effort:** ~200-300 engineering hours

---

## Getting Started

### Week 1 Sprint

**Priority Tasks:**

1. [ ] Review and approve this plan
2. [ ] Create Phase 1 branch: `feature/aismr-v2`
3. [ ] Ingest AISMR specifications (Story 1.1.1)
4. [ ] Ingest AISMR DNA (Story 1.1.2)
5. [ ] Rewrite idea generator persona (Story 1.2.1)
6. [ ] Daily standups to track progress

**Success Criteria:**

- Specifications searchable via MCP
- First persona prompt transformed and tested
- Team aligned on MCP tool usage patterns

---

## Dependencies

### Prerequisites (Already Complete ✅)

- [x] Phase 1-3 of RAG Modernization Plan (hybrid search, memory routing, episodic memory, graph links, adaptive retrieval)
- [x] MCP server running and stable
- [x] Conversation storage working (`conversation.store`)
- [x] Graph link generation functional

### External Dependencies

- n8n stability (backup plan: run workflows locally for testing)
- OpenAI API availability (fallback: cached responses for dev)
- Veo API availability (not needed for Phase 1-2)

---

## Conclusion

This plan transforms AISMR from a rigid, static system into an intelligent, adaptive content generation platform that leverages the full power of our modern MCP infrastructure. By using memory routing, graph traversal, episodic learning, and adaptive retrieval, AISMR 2.0 will generate more unique, higher-quality content while learning from every interaction.

**The journey from static prompts to adaptive intelligence starts with Week 1, Story 1.1.1. Let's build AISMR 2.0! 🎬✨**
