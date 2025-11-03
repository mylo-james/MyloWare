# AISMR Workflow Review - Complete Data Flow Analysis

**Review Date:** November 2, 2025  
**Scope:** AISMR.workflow.json and all sub-workflows  
**Goal:** Identify data flow issues and recommend simplifications

---

## Executive Summary

The AISMR workflow has **significant architectural complexity** with unnecessary workflow nesting, duplicated logic, and critical data flow breaks. The current pattern creates 3 levels of workflow indirection where 1 would suffice. Following the **chat workflow pattern** (inline AI Agent) would dramatically simplify the architecture and improve maintainability.

### Key Findings

1. ✅ **GOOD:** Main orchestration flow is well-structured
2. ❌ **CRITICAL:** Progress notification nodes overwrite upstream payloads, breaking data flow
3. ❌ **CRITICAL:** Mylo_MCP_Bot workflow ends on memory-add, not agent output
4. ❌ **BAD:** Unnecessary workflow indirection through "Mylo MCP Bot"
5. ❌ **BAD:** Duplicated HITL approval polling logic
6. ⚠️ **ISSUE:** Data flow breaks between Generate Ideas and AISMR workflows
7. ⚠️ **ISSUE:** Inconsistent session/run ID handling
8. ⚠️ **ISSUE:** Missing control-flow fallbacks (approval failures, loop limits)

---

## Workflow Architecture Analysis

### Current Architecture (3 Levels Deep)

```
AISMR Workflow (Level 1)
  └─> Generate Ideas Workflow (Level 2)
       └─> Mylo MCP Bot Workflow (Level 3 - AI Agent)
            └─> MCP Tools

  └─> Screen Writer Workflow (Level 2)
       └─> Mylo MCP Bot Workflow (Level 3 - AI Agent)
            └─> MCP Tools
```

### Recommended Architecture (1 Level)

```
AISMR Workflow
  ├─> Idea Generation (AI Agent inline)
  │    └─> MCP Tools
  ├─> Screen Writer (AI Agent inline)
  │    └─> MCP Tools
  ├─> Generate Video Workflow
  ├─> Edit AISMR Workflow
  ├─> Upload to Drive Workflow
  └─> Post to TikTok Workflow
```

---

## Critical Issue: Telegram Nodes Breaking Data Flow

### The Problem

Progress notification nodes in the AISMR workflow sit **inline on the happy-path** and overwrite the upstream payload. Downstream nodes expect workflow run metadata but receive Telegram API response objects instead.

**Affected Nodes:**

- `Progress: Ideas Generated` (Line 272) → Breaks `Request HITL Approval`
- Progress nodes after `Call Screen Writer`, `Call Generate Video`, etc. → Break all subsequent workflow calls

**Example from AISMR workflow:**

```272:315:workflows/AISMR.workflow.json
      "name": "Progress: Ideas Generated",
      ...
      "name": "Request HITL Approval",
```

**What happens:**

1. `Get Run After Ideas` returns workflow run JSON with `stageOutput`, `ideas`, etc.
2. `Progress: Ideas Generated` (Telegram node) sends notification
3. Telegram node returns its own API response (message ID, chat ID, etc.)
4. `Request HITL Approval` receives Telegram payload instead of run data
5. Result: `stageOutput` resolves to `[]`, `userIdea` becomes empty, approval request fails

**Impact:**

- `Request HITL Approval` loses the generated ideas
- `Call Generate Video` expects `videoId` from `$json` but gets Telegram metadata
- `Final: Posted` expects `tiktokUrl` but gets Telegram metadata
- Every stage after each notification node breaks

### The Solution

**Option 1: Branch notifications off main path** (Recommended)

```
Get Run After Ideas
  ├─> Progress: Ideas Generated (branch)
  └─> Request HITL Approval (main path)
```

Use a `Merge` node in passthrough mode to branch notifications without breaking the main data flow.

**Option 2: Explicit node references**

```javascript
// Instead of:
const data = $json;

// Use:
const data = $('Get Run After Ideas').item.json;
```

Reference the upstream node explicitly in every subsequent node.

---

## Node-by-Node Analysis

### ✅ INITIALIZATION PHASE (Nodes 1-6)

| Node                              | Type         | Status  | Notes                                                   |
| --------------------------------- | ------------ | ------- | ------------------------------------------------------- |
| When Executed by Another Workflow | Trigger      | ✅ GOOD | Receives `turnId` correctly                             |
| Get Turn                          | HTTP Request | ✅ GOOD | Fetches turn data from API                              |
| Extract ChatId                    | Code         | ✅ GOOD | Properly extracts chatId, userInput, turn data          |
| Create Run                        | HTTP Request | ✅ GOOD | Creates workflow run with proper metadata               |
| Store RunId                       | Code         | ✅ GOOD | Stores runId in execution custom data for error handler |
| Assemble Context                  | Code         | ✅ GOOD | Assembles runId, chatId, userInput, turn, turnId        |

**Data Flow:** ✅ Clean handoff from node to node

---

### ⚠️ IDEA GENERATION PHASE (Node 7)

#### Current Flow

**Node:** `Call Generate Ideas` → Executes workflow `9tBbhRfA4149YH0f`

**Inputs Passed:**

- `runId`: ✅ Correct
- `userInput`: ✅ Correct

**Problem:** This workflow then calls ANOTHER workflow:

```
Generate Ideas Workflow:
  1. When Called (receives runId, userInput)
  2. Get Run (API) - fetches workflow run
  3. Get Run (Code) - normalizes payload
  4. Call 'Mylo_MCP_Bot' ← UNNECESSARY INDIRECTION
     - Receives: projectId, personaId, chatInput, outputSchema, sessionId
     - BUT: These values are NOT PASSED from AISMR!
```

**Data Flow Issue #1:** Missing inputs to Mylo_MCP_Bot

The `Call 'Mylo_MCP_Bot'` node in Generate Ideas workflow has this configuration:

```json
{
  "workflowInputs": {
    "mappingMode": "defineBelow",
    "value": {}, // ← EMPTY! No values mapped!
    "schema": ["projectId", "personaId", "chatInput", "outputSchema", "sessionId"]
  }
}
```

**Result:** Mylo_MCP_Bot receives NO DATA from parent workflow!

**Data Flow Issue #2:** Mylo_MCP_Bot ends on wrong node

```24:233:workflows/mylo-mcp-bot.workflow.json
      "name": "AI Agent",
      ...
      "name": "Call Memory Add",
```

The workflow ends on `Call Memory Add`, so parent workflows only receive memory RPC results instead of the actual agent response. The agent's structured output (ideas array, screenplay, etc.) exists earlier in the graph but is not guaranteed to reach callers.

**Result:** Generate Ideas workflow expects `output.ideas` but often gets memory-add responses instead, causing `Split Out` node to fail.

---

### ❌ CONTROL FLOW ISSUE: Missing Fallback Branches

Several control-flow branches are either missing or incomplete, leaving runs hanging without status updates or user feedback:

**Missing Branches:**

1. `Check Approval ID` - Only the **true** branch is wired
   - If API fails to return an approval ID, execution stops silently
   - No notification sent to user
   - No retry logic
2. `Check Loop Limit` - False branch is unconnected
   - When poll loop hits 100 iterations, execution stops
   - Run status never updated to "timeout" or "failed"
   - User never notified
3. Final success state - No completion update
   - After TikTok upload succeeds, no final PATCH to mark run complete
   - Runs remain in `publishing` status indefinitely
   - Artifacts (Drive URL, TikTok URL) never recorded

**Impact:** Users don't know when their workflow has failed or completed successfully.

---

### ❌ DUPLICATION ISSUE: HITL Approval Logic

The HITL approval polling is implemented **TWICE** with identical logic:

#### Location 1: Generate Ideas Workflow (Lines 323-574)

- Request HITL Approval
- Check Approval ID
- Prepare Loop
- Check Loop Limit
- Wait Before Polling (5s)
- Get Approval Status
- Check If Approved
- **Loop back if not approved**

#### Location 2: AISMR Workflow (Lines 294-437)

- Request HITL Approval
- Check Approval ID
- Prepare Loop
- Check Loop Limit
- Wait Before Polling (5s)
- Get Approval Status
- Check If Approved
- **Loop back if not approved**

**Problem:** Exact same logic duplicated. If approval logic changes, must update TWO places.

---

### ⚠️ DATA FLOW BREAK: Generate Ideas → AISMR

After `Call Generate Ideas` completes, AISMR workflow has:

**Node:** `Get Run After Ideas`

```javascript
"url": "={{ 'https://mcp-vector.mjames.dev/api/workflow-runs/' +
       ($('Assemble Context').item.json.runId || '') }}"
```

**Problem:** This node fetches the run data AGAIN from the API instead of using the output from `Call Generate Ideas`.

**Why this is problematic:**

1. Extra API call (slower)
2. Race condition potential (what if run updates between calls?)
3. Ignores actual output from Generate Ideas workflow

**What Generate Ideas Returns:**

- The workflow has a `Trigger Screenplay` node at the end
- But AISMR doesn't use this output!

---

### ⚠️ IDEA EXTRACTION ISSUES

**Node:** `Extract Selected Idea` (Lines 440-451)

```javascript
const approval = $('Get Approval Status').item.json.approval ?? {};
const selectedItem = approval.content?.selectedItem ?? null;

const runResponse = $('Get Run After Ideas').item?.json ?? {};
const runPayload =
  runResponse.workflowRun ??
  runResponse.data?.workflowRun ??
  runResponse.data?.run ??
  runResponse.run ??
  runResponse;

const stageOutput = runPayload?.stages?.idea_generation?.output ?? null;
const candidateIdeas = [
  Array.isArray(stageOutput?.ideas) ? stageOutput.ideas : null,
  Array.isArray(runPayload?.output?.ideas) ? runPayload.output.ideas : null,
  Array.isArray(runPayload?.result) ? runPayload.result : null,
];
```

**Issues:**

1. Multiple fallback paths indicate unclear data contract
2. Checking 3+ different locations for ideas
3. Fragile - breaks if API response structure changes

---

### ❌ SCREEN WRITER PHASE (Node 536)

**Same problem as Idea Generation:**

`Call Screen Writer` → Screen Writer Workflow → Mylo_MCP_Bot Workflow

**Inputs Passed to Screen Writer:**

- `runId`: ✅
- `userInput`: ✅
- `ideaId`: ✅

**Missing Context Issue:**

- Screen Writer workflow receives `ideaId` but NOT the selected idea details (title, vibe, description)
- Without this context, the agent cannot personalize the screenplay
- The workflow expects `$('When Called').item.json.ideaId` from parent
- But because parent routes through a Telegram node first, `$json.videoId` goes missing and `ideaId` ends up blank

**Screen Writer then calls Mylo_MCP_Bot with:**

- Empty input mapping (same as Generate Ideas)
- Only sends `chatInput` and `personaId`
- Should also send the selected idea payload so prompts can reference the winning concept

**Additional Issue:**

- The run update logic pulls staged state from `$('Get Run').item.json`
- Repeated invocations can trample concurrent updates
- Not using atomic update patterns

---

### ✅ VIDEO GENERATION ONWARDS (Nodes 612+)

The remaining workflows appear simpler and likely don't use the Mylo_MCP_Bot indirection:

| Workflow        | Status     | Notes                    |
| --------------- | ---------- | ------------------------ |
| Generate Video  | ⚠️ Unknown | Need to inspect workflow |
| Edit AISMR      | ⚠️ Unknown | Need to inspect workflow |
| Upload to Drive | ⚠️ Unknown | Need to inspect workflow |
| Post to TikTok  | ⚠️ Unknown | Need to inspect workflow |

---

## Chat Workflow Comparison

The **chat workflow** uses a much simpler pattern:

```
Chat Workflow:
  1. Telegram Trigger
  2. Check Message Type
  3. Process (transcribe if voice)
  4. Normalize Chat Event
  5. Store User Turn
  6. Assemble Agent Context (Code node)
  7. AI Agent (INLINE!) ← Key difference
     - Connected to: OpenAI Chat Model
     - Connected to: MCP Client Tool
  8. Prepare Assistant Store Request
  9. Store Assistant Turn
  10. Reply in Telegram
```

**Key Pattern:**

- The AI Agent is **inline** in the workflow
- MCP Client is connected directly as a tool
- No sub-workflow indirection
- Agent instructions are in the node's system message:

```
Required Steps
1. Load persona using prompt_search_adaptive and prompt_get for the persona "chat"
2. Load the past conversation with conversation_remember with "recent conversation context"
3. Decide if you have enough information to process user Input
4. Handle user input using any tools provided.
5. Respond to user with tool execution results
```

---

## Recommendations

### Priority Ranking

**CRITICAL (Must Fix):**

1. Fix Telegram nodes breaking data flow
2. Fix Mylo_MCP_Bot ending on memory-add instead of agent output
3. Eliminate Mylo_MCP_Bot indirection (use inline AI Agent)

**HIGH (Should Fix):** 4. Add missing control-flow fallback branches 5. Add final success state update 6. Remove duplicate HITL polling logic

**MEDIUM:** 7. Fix data flow handoffs (stop re-fetching from API) 8. Pass selected idea context to Screen Writer

**LOW:** 9. Standardize data contracts 10. Consolidate session ID handling

---

### 1. ⭐ **CRITICAL: Fix Telegram Nodes Breaking Data Flow**

**Problem:** Progress notification nodes overwrite upstream payloads, breaking all downstream nodes.

**Solution:** Branch notifications off the main path using `Merge` nodes in passthrough mode.

**Implementation:**

```
Before:
Get Run After Ideas → Progress: Ideas Generated → Request HITL Approval
                       (overwrites $json!)

After:
Get Run After Ideas ─┬─> Progress: Ideas Generated (branch)
                     └─> Request HITL Approval (main path, preserves $json)
```

**Apply to all progress notification points:**

- After `Get Run After Ideas` → `Progress: Ideas Generated`
- After `Call Screen Writer` → Progress notification
- After `Call Generate Video` → Progress notification
- After `Call Edit AISMR` → Progress notification
- After `Call Upload to Google Drive` → Progress notification

**Benefits:**

- Fixes ALL data flow breaks in one pattern
- Request HITL Approval gets actual ideas
- Call Generate Video gets videoId
- Final nodes get tiktokUrl
- No need to refactor every downstream node

---

### 2. ⭐ **CRITICAL: Fix Mylo_MCP_Bot Output**

**Problem:** Workflow ends on `Call Memory Add`, returning memory RPC responses instead of agent output.

**Solution:** Reorder nodes so the agent's structured output is the final node.

**Implementation:**

1. Move `Call Memory Add` to a branch (not the main path)
2. Ensure the AI Agent's output parser is the final node
3. Return the structured schema (ideas, screenplay, etc.) to parent workflows

**Alternative:** If keeping Mylo_MCP_Bot is too complex, proceed directly to Recommendation #3.

---

### 3. ⭐ **CRITICAL: Fix Generate Ideas Workflow (Keep as Separate Workflow)**

**Current Problem:**

```
AISMR → Generate Ideas → Mylo_MCP_Bot (receives no data + returns memory-add response)
```

**Solution: Replace Mylo_MCP_Bot call with inline AI Agent IN the Generate Ideas workflow**

```
AISMR → Generate Ideas (with inline AI Agent) → Returns ideas array
```

**Implementation in `generate-ideas.workflow.json`:**

1. Remove `Call 'Mylo_MCP_Bot'` node
2. Add **AI Agent node** (like chat workflow pattern)
3. Connect to:
   - OpenAI Chat Model node
   - MCP Client Tool node
4. Set system message with idea generation instructions
5. Use Structured Output Parser with ideas schema
6. **Keep HITL approval logic in this workflow** (approved: gate expensive operations)
7. Return approved idea + ideas array to parent AISMR workflow

**Benefits:**

- Workflow stays reusable for future use cases
- Eliminates data mapping issues
- Receives proper ideas array (not memory responses)
- HITL approval happens before spending money on screenplay
- Follows chat workflow pattern
- Removes one level of indirection

---

### 3a. ⭐ **CRITICAL: Fix Screen Writer Workflow (Keep as Separate Workflow)**

**Current Problem:**

```
AISMR → Screen Writer → Mylo_MCP_Bot (receives no data + returns memory-add response)
Screen Writer doesn't receive selected idea details (title, vibe, description)
```

**Solution: Replace Mylo_MCP_Bot call with inline AI Agent IN the Screen Writer workflow**

```
AISMR → Screen Writer (with inline AI Agent + idea context) → Returns screenplay
```

**Implementation in `screen-writer.workflow.json`:**

1. Remove `Call 'Mylo_MCP_Bot'` node
2. Update workflow inputs to accept `selectedIdea` object:
   ```json
   {
     "runId": "...",
     "userInput": "...",
     "ideaId": "...",
     "selectedIdea": {
       "title": "...",
       "vibe": "...",
       "description": "..."
     }
   }
   ```
3. Add **AI Agent node** (like chat workflow pattern)
4. Connect to:
   - OpenAI Chat Model node
   - MCP Client Tool node
5. Set system message with screenplay instructions + selected idea context
6. Use Structured Output Parser with screenplay schema
7. Return screenplay to parent AISMR workflow
8. Remove `Trigger Screenplay` duplicate invocation issue

**Benefits:**

- Workflow stays reusable for future use cases
- Agent gets full idea context for better screenplays
- Eliminates data mapping issues
- No duplicate screenplay invocation
- Follows chat workflow pattern
- Removes one level of indirection

---

### 4. **HIGH: Add Missing Control-Flow Fallback Branches**

**Problem:** Several control-flow nodes have missing or incomplete branches, causing silent failures.

**Fixes Required:**

**4a. Wire `Check Approval ID` false branch:**

```javascript
// On false:
1. Mark run as failed
2. Send Telegram notification: "Failed to create approval request"
3. Update run status to "failed"
```

**4b. Wire `Check Loop Limit` false branch:**

```javascript
// On false (loop limit reached):
1. Mark run as failed/timeout
2. Send Telegram notification: "Approval timed out after 100 checks"
3. Update run status to "timeout"
```

**4c. Handle approval rejection:**

```javascript
// After Get Approval Status:
1. Check if approval.status === 'rejected'
2. If rejected, mark run failed and notify user
3. Don't just loop indefinitely
```

---

### 5. **HIGH: Add Final Success State Update**

**Problem:** After TikTok upload succeeds, no PATCH updates the run to "completed".

**Solution:**

```javascript
// New node after "Final: Posted"
// Name: "Mark Run Complete"
// Type: HTTP Request
{
  method: "PATCH",
  url: "https://mcp-vector.mjames.dev/api/workflow-runs/{{ $('Assemble Context').item.json.runId }}",
  body: {
    status: "completed",
    completedAt: new Date().toISOString(),
    output: {
      driveUrl: $('Call Upload to Google Drive').item.json.fileUrl,
      tiktokUrl: $('Call Post to TikTok').item.json.videoUrl,
      videoId: $('Extract Selected Idea').item.json.videoId
    }
  }
}
```

---

### 6. **HIGH: Remove Duplicate HITL Polling Logic**

**Current:**

- HITL polling in Generate Ideas workflow ✅ (KEEP THIS - approved ideas before spending money)
- HITL polling in AISMR workflow ❌ (REMOVE THIS - duplicate)

**Recommended:**

- Keep HITL logic in Generate Ideas workflow ONLY
- Remove HITL polling from AISMR workflow
- Generate Ideas returns approved idea after HITL
- AISMR just calls Screen Writer with the approved idea

**Why:**

- Single source of truth
- Approve ideas before expensive screenplay generation
- Generate Ideas handles its own approval gate
- AISMR becomes simpler orchestrator

---

### 7. **MEDIUM: Fix Data Flow Handoffs**

**Issue:** AISMR re-fetches run data instead of using workflow outputs

**Fix:**

```javascript
// Instead of:
$('Get Run After Ideas'); // API call

// Use direct output:
$('Call Generate Ideas').item.json.ideas;
```

**Implementation:**

- Update Generate Ideas to return proper output
- Update AISMR to consume that output directly
- Remove `Get Run After Ideas` node entirely

---

### 8. **MEDIUM: Pass Selected Idea Context to Screen Writer**

**Problem:** Screen Writer receives `ideaId` but not the idea details (title, vibe, description).

**Solution:**

```javascript
// In "Call Screen Writer" node, pass full idea object:
{
  workflowInputs: {
    runId: $('Assemble Context').item.json.runId,
    userInput: $('Assemble Context').item.json.userInput,
    ideaId: $('Extract Selected Idea').item.json.selectedItem,
    selectedIdea: {  // ADD THIS
      title: $('Extract Selected Idea').item.json.idea.idea,
      vibe: $('Extract Selected Idea').item.json.idea.vibe,
      description: $('Extract Selected Idea').item.json.idea.description
    }
  }
}
```

---

### 9. **LOW: Standardize Data Contracts**

**Problem:** Multiple fallback paths for extracting ideas

**Fix:** Define clear data contracts:

```typescript
// Generate Ideas Output
{
  ideas: Array<{
    idea: string,
    vibe: string,
    ideaId: string
  }>,
  userIdea: string,
  totalIdeas: number
}

// Screen Writer Output
{
  screenplay: {
    scenes: Array<Scene>,
    duration: number,
    // ...
  },
  videoId: string
}
```

---

### 10. **LOW: Consolidate Session ID Handling**

**Current:** sessionId passed through multiple workflows inconsistently

**Recommended:**

- Set sessionId at the AISMR workflow level
- Pass it explicitly to all sub-components
- Use consistent naming (not sessionId vs session_id vs conversationSessionId)

---

## Proposed Refactored AISMR Workflow

```
AISMR Workflow (Orchestrator)
─────────────────────────────
1. When Executed by Another Workflow (receives turnId)
2. Get Turn (fetch turn data)
3. Extract ChatId (extract chatId, userInput, turn)
4. Create Run (create workflow run record)
5. Store RunId (store in execution context)
6. Assemble Context (prepare data for workflows)

7. Call Generate Ideas Workflow ──────────────┐
   │                                           │
   │  Generate Ideas Workflow (Separate)      │
   │  ────────────────────────────────────     │
   │  - Receive: runId, userInput             │
   │  - AI Agent (INLINE with MCP tools)      │
   │  - Generate ideas array                   │
   │  - HITL Approval Loop (approve ideas)    │
   │  - Return: ideas[], selectedIdea         │
   └───────────────────────────────────────────┘

8. Progress: Ideas Generated (BRANCHED, doesn't break data flow)
9. Extract Selected Idea (from workflow output)

10. Call Screen Writer Workflow ──────────────┐
    │                                          │
    │  Screen Writer Workflow (Separate)      │
    │  ──────────────────────────────────      │
    │  - Receive: runId, userInput, ideaId,   │
    │             selectedIdea (full context) │
    │  - AI Agent (INLINE with MCP tools)     │
    │  - Generate screenplay                   │
    │  - Return: screenplay, videoId          │
    └──────────────────────────────────────────┘

11. Progress: Screenplay Generated (BRANCHED)

12. Call Generate Video (workflow)
13. Progress: Video Generated (BRANCHED)

14. Call Edit AISMR (workflow)
15. Progress: Video Edited (BRANCHED)

16. Call Upload to Drive (workflow)
17. Progress: Uploaded to Drive (BRANCHED)

18. Call Post to TikTok (workflow)
19. Progress: Posted to TikTok (BRANCHED)

20. Mark Run Complete (PATCH status="completed" + artifacts)
21. Final: Posted (success notification)
```

**Key Changes from Current:**

- ✅ Generate Ideas + Screen Writer stay separate (reusable)
- ✅ Both use inline AI Agents (no Mylo_MCP_Bot)
- ✅ HITL stays in Generate Ideas (gate before expensive ops)
- ✅ All progress notifications BRANCHED (don't break data flow)
- ✅ Screen Writer receives full idea context
- ✅ Final success state properly recorded
- ✅ Reduced from 3 levels to 2 levels (AISMR → Ideas/Writer)
- ✅ No duplicate HITL polling

---

## Migration Path

### Phase 0: Quick Wins - Fix Critical Data Flow (2-4 hours) ⭐ **DO THIS FIRST**

These fixes provide immediate value with minimal risk:

**Step 1: Fix Telegram Node Data Flow (1-2 hours)**

1. Identify all inline Telegram notification nodes
2. Add `Merge` nodes in passthrough mode before each notification
3. Route notifications as branches, not inline
4. Test that `Request HITL Approval` receives correct ideas
5. Test that `Call Generate Video` receives videoId

**Step 2: Add Control Flow Fallbacks (1 hour)**

1. Wire `Check Approval ID` false branch → Mark run failed + notify user
2. Wire `Check Loop Limit` false branch → Mark run timeout + notify user
3. Add approval rejection handling in poll loop
4. Test failure scenarios

**Step 3: Add Final Success State (30 mins)**

1. Add `Mark Run Complete` node after `Final: Posted`
2. PATCH run status to "completed" with artifacts
3. Test complete workflow execution

**Expected Results:**

- ✅ HITL approval works correctly with ideas
- ✅ Video generation receives proper videoId
- ✅ Users get notified on failures
- ✅ Runs show proper completion status
- ✅ No workflow refactoring needed yet

---

### Phase 1: Fix Mylo_MCP_Bot Output (1-2 hours)

**Option A: Quick Fix (30 mins)**

1. In `mylo-mcp-bot.workflow.json`, branch `Call Memory Add` off main path
2. Make the AI Agent's output parser the final node
3. Test that parent workflows receive structured output

**Option B: Skip to Phase 2** (Eliminate Mylo_MCP_Bot entirely)

---

### Phase 2: Fix Generate Ideas Workflow (2-3 hours)

**Goal:** Make Generate Ideas work properly with inline AI Agent + keep HITL

1. **Backup:** Export `generate-ideas.workflow.json` to archive
2. **Remove:** Delete `Call 'Mylo_MCP_Bot'` node
3. **Add:** AI Agent node (pattern from chat workflow)
4. **Connect:**
   - OpenAI Chat Model node
   - MCP Client Tool node (with prompt_get, prompt_search_adaptive)
5. **Configure:** System message with idea generation instructions
6. **Add:** Structured Output Parser for ideas schema
7. **Keep:** HITL approval polling logic (as-is)
8. **Fix:** Return approved idea + ideas array properly
9. **Test:** Call from AISMR with test data, verify ideas return correctly

**Expected Output:**

```json
{
  "ideas": [...],
  "selectedIdea": {...},
  "approvalId": "...",
  "userIdea": "..."
}
```

---

### Phase 3: Fix Screen Writer Workflow (2-3 hours)

**Goal:** Make Screen Writer work with inline AI Agent + receive idea context

1. **Backup:** Export `screen-writer.workflow.json` to archive
2. **Update inputs:** Add `selectedIdea` parameter to workflow trigger
3. **Remove:** Delete `Call 'Mylo_MCP_Bot'` node
4. **Remove:** Delete `Trigger Screenplay` node (duplicate invocation)
5. **Add:** AI Agent node (pattern from chat workflow)
6. **Connect:**
   - OpenAI Chat Model node
   - MCP Client Tool node
7. **Configure:** System message with screenplay instructions + idea context
8. **Add:** Structured Output Parser for screenplay schema
9. **Fix:** Return screenplay properly
10. **Update AISMR:** Pass `selectedIdea` object when calling Screen Writer
11. **Test:** Call from AISMR with test idea, verify screenplay generation

**Expected Output:**

```json
{
  "screenplay": {
    "scenes": [...],
    "duration": 60,
    "videoId": "..."
  }
}
```

---

### Phase 4: Remove Duplicate HITL from AISMR (1 hour)

**Goal:** Simplify AISMR by removing duplicate HITL logic

1. **Identify:** HITL polling nodes in AISMR (lines 294-437)
2. **Remove:** Delete duplicate HITL nodes:
   - Request HITL Approval
   - Check Approval ID
   - Prepare Loop
   - Check Loop Limit
   - Wait Before Polling
   - Get Approval Status
   - Check If Approved
3. **Update:** `Extract Selected Idea` node to read from Generate Ideas output
4. **Simplify:** Direct flow from `Call Generate Ideas` → `Extract Selected Idea` → `Call Screen Writer`
5. **Test:** End-to-end AISMR flow

---

### Phase 5: Cleanup (1 hour)

**Goal:** Archive old workflows and standardize contracts

1. **Archive:** Move `mylo-mcp-bot.workflow.json` to archive folder
2. **Document:** Create TypeScript interfaces for workflow contracts
3. **Standardize:** Data contracts across workflows
4. **Update:** AISMR to properly pass `selectedIdea` to Screen Writer
5. **Test:** Full end-to-end AISMR execution
6. **Update:** Documentation with new architecture diagram

---

## Risk Assessment

| Risk                                         | Severity | Mitigation                                          |
| -------------------------------------------- | -------- | --------------------------------------------------- |
| Breaking existing executions                 | LOW      | Test thoroughly with pinned data first              |
| Telegram node branching breaks notifications | LOW      | Test notifications still send correctly             |
| MCP tools not working inline                 | LOW      | Chat workflow proves this works                     |
| Output schema changes                        | MEDIUM   | Define clear contracts, use TypeScript types        |
| Performance degradation                      | LOW      | Should actually improve (fewer hops)                |
| Double screenplay invocation                 | MEDIUM   | Remove trigger from Generate Ideas in Phase 3       |
| Concurrent run updates                       | MEDIUM   | Use atomic PATCH operations with optimistic locking |

---

## Success Metrics

### After Phase 0 (Quick Wins):

1. ✅ HITL approval receives correct ideas (not empty array)
2. ✅ Video generation receives videoId (not Telegram metadata)
3. ✅ Users notified on approval failures/timeouts
4. ✅ Runs marked "completed" with artifacts on success
5. ✅ No silent failures in control flow
6. ✅ All progress notifications send correctly

### After Full Refactoring (Phases 1-5):

1. ✅ Reduced execution time (fewer workflow hops)
2. ✅ Simplified debugging (single workflow to inspect)
3. ✅ Easier modifications (all logic in one place)
4. ✅ Consistent with chat workflow pattern
5. ✅ Eliminated duplicate HITL polling logic
6. ✅ Clear data flow (no re-fetching from API)
7. ✅ Screen Writer receives full idea context
8. ✅ No workflow indirection through Mylo_MCP_Bot

---

## Conclusion

The AISMR workflow has **two categories of issues**:

### Critical Data Flow Bugs (Fix Immediately)

1. **Telegram nodes overwrite payloads** → Breaking all downstream nodes
2. **Mylo_MCP_Bot returns memory data** → Not agent output
3. **Missing control flow branches** → Silent failures, no user feedback
4. **No completion status** → Runs stuck in "publishing" forever

**Impact:** The workflow is likely **not working in production** due to these bugs.

**Quick Win:** Phase 0 fixes can be implemented in **2-4 hours** and will make the workflow functional.

---

### Architectural Complexity (Refactor When Ready)

1. **3 levels of workflow nesting** → Should be 1 level
2. **Duplicate HITL polling** → Should be in one place
3. **Missing context passing** → Screen Writer lacks idea details
4. **Data contract inconsistency** → Multiple fallback paths

**Impact:** Makes the workflow hard to maintain and debug.

**Long-term Fix:** Phases 1-5 eliminate complexity by following the chat workflow pattern.

---

**Recommendation:**

1. **Start with Phase 0** (Quick Wins) to fix critical bugs
2. **Test thoroughly** with real executions
3. **Then proceed** with Phases 1-5 for architectural improvements

---

## Questions for Discussion

### Phase 0 (Quick Wins)

1. ✅ **DECIDED:** Use Merge nodes (passthrough mode) for Telegram branching
2. ✅ **DECIDED:** Create "rejected" status and notify user on approval rejection
3. ✅ **DECIDED:** Use separate "timeout" status (distinct from "failed")

### Phase 1-5 (Refactoring)

1. ✅ **DECIDED:** Archive Mylo_MCP_Bot in Phase 5 (only used by Ideas/Writer)
2. ✅ **DECIDED:** Keep Generate Ideas/Screen Writer as separate workflows (plans for reuse)
3. ✅ **DECIDED:** Keep HITL in Generate Ideas (approve before spending money on screenplay)
4. ✅ **DECIDED:** Audit video generation workflows after Phase 5
5. ✅ **DECIDED:** Create TypeScript interfaces for workflow data contracts

### Testing Strategy

1. ✅ **DECIDED:** Use real data if we can get a full run, otherwise use fake data
2. ✅ **DECIDED:** Nothing is working now, so we can't regress - proceed with confidence
3. ✅ **DECIDED:** Archive old workflows until we know we don't need the history

---

## Appendix: Additional Findings from REVIEW-codex.md

### Generate Ideas Workflow Double-Invocation Issue

The `Generate Ideas` workflow has a `Trigger Screenplay` node that calls the Screen Writer workflow as soon as HITL approval completes. However, the parent AISMR workflow **also** calls Screen Writer after extracting the selected idea.

**Result:** Screenplay generation may run twice, potentially:

- Creating duplicate database records
- Overwriting state
- Wasting API credits

**Fix:** Remove the `Trigger Screenplay` node from Generate Ideas workflow in Phase 3.

---

### Screen Writer Concurrent Update Risk

The Screen Writer workflow pulls staged state from `$('Get Run').item.json` and then updates it. If multiple executions run concurrently (due to the double-invocation issue above), they can trample each other's updates.

**Fix:** Use atomic PATCH operations with version tracking or optimistic locking.

---

### Error Handler Robustness

The AISMR workflow's error handler is well-designed with multiple fallback paths to recover `runId` and `chatId`. However, its effectiveness depends on:

1. `Store RunId` node executing before failures (currently ✅)
2. All nodes properly propagating execution context
3. Database being available for PATCH operations

**Recommendation:** Add error handler tests to verify it works for different failure points.

---

**Reviewed by:** AI Assistant (Merged from REVIEW.md + REVIEW-codex.md)  
**Next Steps:**

1. Review findings with team
2. Prioritize Phase 0 quick wins for immediate deployment
3. Plan Phase 1-5 refactoring for next sprint

---

## Final Architecture (Post-Refactor)

**Status:** ✅ Completed November 2, 2025

### Refactored Architecture (2 Levels)

```
AISMR Workflow (Level 1)
├─ Generate Ideas Workflow (Level 2)
│  ├─ AI Agent (inline) + MCP Tools
│  └─ HITL Approval (polling loop)
├─ Screen Writer Workflow (Level 2)
│  └─ AI Agent (inline) + MCP Tools
├─ Generate Video Workflow
├─ Edit AISMR Workflow
├─ Upload to Drive Workflow
└─ Post to TikTok Workflow
```

### Improvements Made

- ✅ **Reduced from 3 levels to 2 levels** - Eliminated Mylo_MCP_Bot indirection
- ✅ **Single HITL approval** - HITL logic now only in Generate Ideas workflow
- ✅ **Proper data contracts** - TypeScript types defined in `src/types/workflow-contracts.ts`
- ✅ **Progress notifications branched** - Notifications no longer break data flow (using Merge nodes with passthrough mode)
- ✅ **Complete status tracking** - All workflow stages update run status properly
- ✅ **Removed duplicate logic** - Eliminated duplicate HITL polling from AISMR workflow
- ✅ **Fixed data flow** - Generate Ideas returns `{ ideas, selectedIdea, approvalId, userIdea }` directly
- ✅ **Proper error handling** - All failure paths have handlers (approval failure, timeout, rejection)

### Workflow Data Contracts

See `src/types/workflow-contracts.ts` for complete TypeScript definitions:

- `GenerateIdeasInput` / `GenerateIdeasOutput`
- `ScreenWriterInput` / `ScreenWriterOutput`
- `WorkflowRunContext` / `WorkflowRunStatus` / `WorkflowRunOutput`

### Migration Notes

- **Mylo_MCP_Bot workflow** archived to `workflows/archive/`
- **Generate Ideas workflow** now uses inline AI Agent with MCP Tools
- **Screen Writer workflow** now uses inline AI Agent with idea context
- **AISMR workflow** simplified - removed duplicate HITL, uses Generate Ideas output directly
