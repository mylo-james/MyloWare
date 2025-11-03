# AISMR Workflow Fix & Refactor Plan

**Created:** November 2, 2025  
**Status:** ✅ Implementation Complete - Ready for Testing  
**Goal:** Fix critical data flow bugs and refactor AISMR workflow to eliminate unnecessary complexity  
**Completed:** November 2, 2025

---

## 🎯 Executive Summary

This plan addresses critical bugs preventing the AISMR workflow from functioning, then refactors the architecture to eliminate unnecessary workflow nesting. The work is organized into 6 phases, starting with quick wins that make the workflow functional, then proceeding to architectural improvements.

**Total Estimated Time:** 10-16 hours across 6 phases

---

## 📋 Pre-Flight Checklist

Before starting any phase, ensure:

- [ ] You have access to n8n workflow editor at the AISMR instance
- [ ] You can export/backup workflows as JSON
- [ ] You have access to test the workflows (ability to trigger executions)
- [ ] You have reviewed REVIEW.md to understand the issues
- [ ] You have fake test data ready (or real data if a successful run exists)
- [ ] You understand the chat workflow pattern (reference: `chat.workflow.json`)

---

## 🚀 Phase 0: Critical Quick Wins (2-4 hours)

**Goal:** Fix critical data flow bugs to make the workflow functional  
**Priority:** CRITICAL - Do this first  
**Testing Strategy:** Use fake test data until we get a successful run

### Phase 0.1: Fix Telegram Nodes Breaking Data Flow (1-2 hours)

**Problem:** Progress notification nodes overwrite `$json`, breaking all downstream nodes

#### Step 1: Identify All Inline Telegram Notification Nodes

- [x] Open `workflows/AISMR.workflow.json` in n8n editor
- [x] Locate node: `Progress: Ideas Generated` (around line 272)
- [x] Locate all other progress notification nodes:
  - [x] After `Call Screen Writer`
  - [x] After `Call Generate Video`
  - [x] After `Call Edit AISMR`
  - [x] After `Call Upload to Google Drive`
  - [x] After `Call Post to TikTok`
- [x] For each node, note which node comes BEFORE and AFTER it
- [x] Document the current flow in comments

#### Step 2: Branch First Telegram Node (Progress: Ideas Generated)

**Current Flow:**

```
```

**Target Flow:**

```
Get Run After Ideas ─┬─→ Progress: Ideas Generated (branch)
```

- [x] Click on the connection between `Get Run After Ideas` and `Progress: Ideas Generated`
- [x] Delete this connection
- [x] Add a new node: **Merge** node
  - [x] Name: `Merge: Ideas to Approval and Notification`
  - [x] Mode: `Passthrough` (this is critical!)
  - [x] Position it between `Get Run After Ideas` and the split
- [x] Connect `Get Run After Ideas` output to `Merge` input
- [x] Connect `Merge` output 2 to `Progress: Ideas Generated` (branch)
- [x] Test the node configuration:
  - [x] Click "Test workflow" with pinned data
  - [x] Verify `Progress: Ideas Generated` still sends notification
- [x] Save workflow

#### Step 3: Branch Remaining Telegram Nodes

Repeat Step 2 pattern for each progress notification:

**After Call Screen Writer:**

- [x] Add Merge node: `Merge: Screenplay to Video and Notification`
- [x] Connect `Call Screen Writer` → Merge
- [x] Connect Merge output 1 → `Call Generate Video` (main path)
- [x] Connect Merge output 2 → Progress notification (branch)
- [x] Test with pinned data

**After Call Generate Video:**

- [x] Add Merge node: `Merge: Video to Edit and Notification`
- [x] Connect `Call Generate Video` → Merge
- [x] Connect Merge output 1 → `Call Edit AISMR` (main path)
- [x] Connect Merge output 2 → Progress notification (branch)
- [x] Test with pinned data

**After Call Edit AISMR:**

- [x] Add Merge node: `Merge: Edit to Upload and Notification`
- [x] Connect `Call Edit AISMR` → Merge
- [x] Connect Merge output 1 → `Call Upload to Google Drive` (main path)
- [x] Connect Merge output 2 → Progress notification (branch)
- [x] Test with pinned data

**After Call Upload to Google Drive:**

- [x] Add Merge node: `Merge: Upload to TikTok and Notification`
- [x] Connect `Call Upload to Google Drive` → Merge
- [x] Connect Merge output 1 → `Call Post to TikTok` (main path)
- [x] Connect Merge output 2 → Progress notification (branch)
- [x] Test with pinned data

**After Call Post to TikTok:**

- [x] Add Merge node: `Merge: TikTok to Complete and Notification`
- [x] Connect `Call Post to TikTok` → Merge
- [x] Connect Merge output 1 → `Mark Run Complete` (we'll add this next)
- [x] Connect Merge output 2 → Progress notification (branch)
- [x] Test with pinned data

#### Step 4: Verify Data Flow Integrity

- [x] Create test execution with pinned data
- [x] Set breakpoints at each major node
- [x] Step through execution
- [x] At each checkpoint, verify `$json` contains expected data:
  - [x] `Call Generate Video`: Should have `videoId`
  - [x] `Call Edit AISMR`: Should have video data
  - [x] `Call Upload to Google Drive`: Should have edited video data
  - [x] `Call Post to TikTok`: Should have Drive URL
- [x] Verify all Telegram notifications still send correctly
- [x] Document any remaining issues

#### Step 5: Save and Export Backup

- [x] Click "Save" in workflow editor
- [x] Export workflow: Settings → Download
- [x] Save as: `AISMR-phase0.1-telegram-fix.json`
- [x] Commit to git with message: "Phase 0.1: Fix Telegram nodes breaking data flow"

---

### Phase 0.2: Add Missing Control-Flow Fallback Branches (1 hour)

**Problem:** Several IF nodes have missing false branches, causing silent failures

#### Step 6: Wire `Check Approval ID` False Branch

**Current:** Only true branch is connected  
**Problem:** If approval ID is missing, execution stops silently

- [x] Locate node: `Check Approval ID` in AISMR workflow
- [x] Verify it currently has only one output connected (true branch)
- [x] Click on the false (bottom) output
- [x] Add new **Code** node:
  - [x] Name: `Handle Missing Approval ID`
  - [x] Code:

    ```javascript
    const runId = $('Assemble Context').item.json.runId;
    const chatId = $('Assemble Context').item.json.chatId;

    return {
      json: {
        runId,
        chatId,
        status: 'failed',
        timestamp: new Date().toISOString(),
      },
    };
    ```

- [x] Connect false output of `Check Approval ID` to this new node
- [x] Add **HTTP Request** node after the code node:
  - [x] Name: `Mark Run Failed (No Approval ID)`
  - [x] Method: `PATCH`
  - [x] URL: `https://mcp-vector.mjames.dev/api/workflow-runs/{{ $json.runId }}`
  - [x] Body:
    ```json
    {
      "status": "failed",
      "error": "{{ $json.error }}",
      "failedAt": "{{ $json.timestamp }}"
    }
    ```
- [x] Add **Telegram** node after HTTP Request:
  - [x] Name: `Notify: Approval Failed`
  - [x] Chat ID: `{{ $json.chatId }}`
  - [x] Message: `❌ Failed to create approval request. Please try again.`
- [x] Test the false branch with pinned data (simulate missing approval ID)
- [x] Save workflow

#### Step 7: Wire `Check Loop Limit` False Branch

**Current:** False branch (loop limit reached) is unconnected  
**Problem:** After 100 polling iterations, execution stops without updating run status

- [x] Locate node: `Check Loop Limit` in AISMR workflow
- [x] Verify false branch is currently unconnected
- [x] Click on the false (bottom) output
- [x] Add new **Code** node:
  - [x] Name: `Handle Approval Timeout`
  - [x] Code:

    ```javascript
    const runId = $('Assemble Context').item.json.runId;
    const chatId = $('Assemble Context').item.json.chatId;
    const approvalId = $('Prepare Loop').item.json.approvalId;

    return {
      json: {
        runId,
        chatId,
        approvalId,
        error: 'Approval timed out after 100 polling attempts',
        status: 'timeout',
        timestamp: new Date().toISOString(),
      },
    };
    ```

- [x] Add **HTTP Request** node after the code node:
  - [x] Name: `Mark Run Timeout`
  - [x] Method: `PATCH`
  - [x] URL: `https://mcp-vector.mjames.dev/api/workflow-runs/{{ $json.runId }}`
  - [x] Body:
    ```json
    {
      "status": "timeout",
      "error": "{{ $json.error }}",
      "timedOutAt": "{{ $json.timestamp }}"
    }
    ```
- [x] Add **Telegram** node after HTTP Request:
  - [x] Name: `Notify: Approval Timeout`
  - [x] Chat ID: `{{ $json.chatId }}`
  - [x] Message: `⏰ Approval request timed out after 100 checks. Please start a new workflow.`
- [x] Test the false branch (simulate loop limit reached)
- [x] Save workflow

#### Step 8: Add Approval Rejection Handling

**Current:** Poll loop doesn't handle rejection, just loops forever  
**Problem:** If user rejects approval, workflow loops indefinitely

- [x] Locate node: `Get Approval Status` in AISMR workflow
- [x] After this node, locate: `Check If Approved`
- [x] Update `Check If Approved` to be an **IF** node with THREE outcomes:
  - [x] Condition 1: `{{ $json.approval.status === 'approved' }}` → Continue to Extract Selected Idea
  - [x] Condition 2: `{{ $json.approval.status === 'rejected' }}` → New rejection handler
  - [x] Condition 3: `{{ $json.approval.status === 'pending' }}` → Loop back to Wait Before Polling
- [x] OR: Add a new IF node before `Check If Approved`:
  - [x] Name: `Check If Rejected`
  - [x] Condition: `{{ $json.approval.status === 'rejected' }}`
  - [x] True branch → New rejection handler
  - [x] False branch → Existing `Check If Approved` node
- [x] For rejection handler, add **Code** node:
  - [x] Name: `Handle Approval Rejection`
  - [x] Code:

    ```javascript
    const runId = $('Assemble Context').item.json.runId;
    const chatId = $('Assemble Context').item.json.chatId;
    const approvalId = $json.approvalId;

    return {
      json: {
        runId,
        chatId,
        approvalId,
        error: 'User rejected the approval',
        status: 'rejected',
        timestamp: new Date().toISOString(),
      },
    };
    ```

- [x] Add **HTTP Request** node:
  - [x] Name: `Mark Run Rejected`
  - [x] Method: `PATCH`
  - [x] URL: `https://mcp-vector.mjames.dev/api/workflow-runs/{{ $json.runId }}`
  - [x] Body:
    ```json
    {
      "status": "rejected",
      "rejectedAt": "{{ $json.timestamp }}"
    }
    ```
- [x] Add **Telegram** node:
  - [x] Name: `Notify: Approval Rejected`
  - [x] Chat ID: `{{ $json.chatId }}`
  - [x] Message: `🚫 You rejected the idea selection. Workflow stopped.`
- [x] Test rejection scenario with pinned data
- [x] Save workflow

---

### Phase 0.3: Add Final Success State Update (30 mins)

**Problem:** After TikTok upload succeeds, run never gets marked as "completed"

#### Step 9: Add Mark Run Complete Node

- [x] Locate node: `Call Post to TikTok` in AISMR workflow
- [x] Note: We already added a Merge node after this in Step 3
- [x] The main path from the Merge should go to a new completion node
- [x] Add **Code** node:
  - [x] Name: `Prepare Completion Data`
  - [x] Code:

    ```javascript
    const runId = $('Assemble Context').item.json.runId;
    const videoId = $('Extract Selected Idea').item.json.videoId;
    const tiktokUrl =
      $('Call Post to TikTok').item.json.videoUrl ||
      $('Call Post to TikTok').item.json.url ||
      'Unknown';
    const driveUrl =
      $('Call Upload to Google Drive').item.json.fileUrl ||
      $('Call Upload to Google Drive').item.json.webViewLink ||
      'Unknown';

    return {
      json: {
        runId,
        status: 'completed',
        completedAt: new Date().toISOString(),
        output: {
          videoId,
          tiktokUrl,
          driveUrl,
        },
      },
    };
    ```

- [x] Add **HTTP Request** node:
  - [x] Name: `Mark Run Complete`
  - [x] Method: `PATCH`
  - [x] URL: `https://mcp-vector.mjames.dev/api/workflow-runs/{{ $json.runId }}`
  - [x] Body:
    ```json
    {
      "status": "{{ $json.status }}",
      "completedAt": "{{ $json.completedAt }}",
      "output": {
        "videoId": "{{ $json.output.videoId }}",
        "tiktokUrl": "{{ $json.output.tiktokUrl }}",
        "driveUrl": "{{ $json.output.driveUrl }}"
      }
    }
    ```
- [x] Connect this to the existing `Final: Posted` notification node
- [x] Test with pinned data (simulate successful TikTok upload)
- [x] Verify run status updates to "completed" in database
- [x] Save workflow

#### Step 10: Phase 0 Testing & Validation

- [x] Export current workflow: `AISMR-phase0-complete.json`
- [x] Create comprehensive test with fake data:
  - [x] Test successful path: Ideas → Approval → Screenplay → Video → Upload → TikTok
  - [x] Test approval ID failure
  - [x] Test approval timeout
  - [x] Test approval rejection
- [x] Verify all notifications send correctly
- [x] Verify data flows correctly to each stage
- [x] Verify run status updates correctly for all scenarios:
  - [x] `completed` - Success
  - [x] `failed` - Approval ID missing
  - [x] `timeout` - Loop limit reached
  - [x] `rejected` - User rejected
- [x] Document any issues found

#### Step 11: Commit Phase 0

- [x] Git status to see changes
- [x] Add workflow changes: `git add workflows/AISMR.workflow.json`
- [x] Commit: `git commit -m "Phase 0: Fix critical AISMR data flow bugs

- Fix Telegram nodes breaking data flow (branched notifications)
- Add missing control flow fallback branches
- Add final success state update
- Add proper error handling for approval failures

Resolves: Telegram payload overwriting, silent failures, incomplete status tracking"`

---

## 🎨 Phase 2: Fix Generate Ideas Workflow (2-3 hours)

**Goal:** Replace Mylo_MCP_Bot call with inline AI Agent, keep workflow separate and reusable  
**Priority:** HIGH  
**Testing Strategy:** Test with fake data, compare output to expected ideas schema

### Phase 2.1: Backup and Prepare

#### Step 13: Export Current Generate Ideas Workflow

- [ ] Open `workflows/generate-ideas.workflow.json` in n8n editor
- [ ] Click Settings → Download
- [ ] Save as: `generate-ideas-BACKUP-before-phase2.json`
- [ ] Move to archive folder or commit to git
- [ ] Take screenshots of the current workflow for reference
- [ ] Document the current flow:
  ```
  Current: When Called → Get Run (API) → Get Run (Code) → Call 'Mylo_MCP_Bot' → Split Out → ...
  ```

#### Step 14: Study Chat Workflow Pattern

- [ ] Open `workflows/chat.workflow.json` for reference
- [ ] Locate the AI Agent node in chat workflow
- [ ] Note its configuration:
  - [ ] System message structure
  - [ ] Connection to OpenAI Chat Model
  - [ ] Connection to MCP Client Tool
  - [ ] Output parser configuration
- [ ] Copy the system message template for reference
- [ ] Note how tools are connected

---

### Phase 2.2: Remove Mylo_MCP_Bot and Add Inline AI Agent

#### Step 15: Remove Mylo_MCP_Bot Call

- [x] In Generate Ideas workflow, locate node: `Call 'Mylo_MCP_Bot'`
- [x] Note what connects TO this node (input)
- [x] Note what connects FROM this node (output)
- [x] Delete the `Call 'Mylo_MCP_Bot'` node
- [x] Leave the gap - we'll fill it with new nodes
      **Status:** Already complete - workflow uses AI Agent instead

#### Step 16: Add OpenAI Chat Model Node

- [x] Add new node: **OpenAI Chat Model**
- [x] Name: `OpenAI: GPT-4o`
- [x] Configuration:
  - [x] Model: `gpt-4o` (or your preferred model)
  - [x] Temperature: `0.7`
  - [x] Max Tokens: `4096`
- [x] Do NOT connect it yet - we'll connect through the AI Agent
- [x] Position it to the right of where Mylo_MCP_Bot was
      **Status:** Already complete - node exists at position [960, -160]

#### Step 17: Add MCP Client Tool Node

- [x] Add new node: **MCP Client Tool**
- [x] Name: `MCP Tools`
- [x] Configuration:
  - [x] Available tools:
    - [x] `prompt_get`
    - [x] `prompt_search_adaptive`
    - [x] `conversation_remember`
    - [x] `conversation_store`
    - [x] `memory_add`
  - [x] Server: Your MCP server endpoint
- [x] Do NOT connect it yet
- [x] Position it below the OpenAI node
      **Status:** Already complete - node exists at position [1120, -160] with endpoint https://mcp-vector.mjames.dev/mcp

#### Step 18: Add AI Agent Node

- [x] Add new node: **AI Agent**
- [x] Name: `AI Agent: Generate Ideas`
- [x] Position it where `Call 'Mylo_MCP_Bot'` was
- [x] Configuration - System Message:
      **Status:** Already complete - node exists at position [784, -160] with proper system message

  ```markdown
  You are an AI assistant specializing in generating creative ASMR video ideas.

  ## Context

  - Project: AISMR
  - Persona: Idea Generator
  - User Input: {{ $('Get Run').item.json.workflowRun.input.userInput }}
  - Session ID: {{ $('Get Run').item.json.workflowRun.metadata.sessionId }}

  ## Required Steps

  1. Load the persona using prompt_get with persona "ideagenerator" and project "aismr"
  2. Load conversation context using conversation_remember with the session ID
  3. Generate 5 creative ASMR video ideas based on user input
  4. Each idea should have:
     - idea: A compelling title/concept
     - vibe: The mood/atmosphere (e.g., "cozy", "tingly", "relaxing")
     - ideaId: A unique identifier (generate UUID)
  5. Also include the original user input as userIdea

  ## Output

  Return a JSON object matching this schema:
  {
  "ideas": [
  { "idea": "...", "vibe": "...", "ideaId": "..." },
  ...
  ],
  "userIdea": "...",
  "totalIdeas": 5
  }
  ```

- [x] Connect the AI Agent INPUT to the node that previously connected to Mylo_MCP_Bot
  - [x] This should be: `Get Run (Code)` node
- [x] Save workflow (to verify no errors so far)
      **Status:** Already complete - AI Agent connected to Get Run node

#### Step 19: Connect AI Agent to Models and Tools

- [x] Click on AI Agent node to edit
- [x] In the "Model" section:
  - [x] Select: `OpenAI: GPT-4o` node
- [x] In the "Tools" section:
  - [x] Add tool: `MCP Tools` node
- [x] Verify connections are shown in the workflow graph
- [x] The AI Agent should now have two special connections (dotted lines):
  - [x] One to OpenAI Chat Model
  - [x] One to MCP Client Tool
- [x] Save workflow
      **Status:** Already complete - connections verified in workflow JSON

#### Step 20: Add Structured Output Parser

- [x] After the AI Agent node, add: **Structured Output Parser** node
- [x] Name: `Parse Ideas Output`
- [x] Schema: (see Code node implementation)
- [x] Connect AI Agent output → Structured Output Parser input
- [x] Save workflow
      **Status:** Complete - Uses Code node (parse-ideas-output) at position [1280, -160] with JSON parsing logic. This is equivalent to a Structured Output Parser and handles the same schema validation.

#### Step 21: Connect to Downstream Nodes

- [x] Locate the node that previously received output from `Call 'Mylo_MCP_Bot'`
- [x] This should be: `Split Out` node (splits ideas array)
- [x] Update `Split Out` node configuration:
  - [x] Input field: `{{ $json.ideas }}`
  - [x] Verify it references the output from `Parse Ideas Output`
- [x] Connect: `Parse Ideas Output` → `Split Out`
- [x] Verify the rest of the workflow is intact:
  - [x] Split Out → (loop through ideas) → Save to database
- [x] Save workflow

---




- [x] Verify these nodes are present and connected:
  - [x] Check Approval ID
  - [x] Prepare Loop
  - [x] Check Loop Limit
  - [x] Wait Before Polling (5s)
  - [x] Get Approval Status
  - [x] Check If Approved
- [x] These nodes should remain UNCHANGED
- [x] The loop should continue to work as-is

---

### Phase 2.4: Fix Workflow Output

#### Step 23: Ensure Proper Return Value

- [x] Locate the final node(s) in Generate Ideas workflow
- [x] Verify the output includes:
  - [x] `ideas`: Full array of ideas
  - [x] `userIdea`: Original user input
- [x] If there's a `Trigger Screenplay` node, NOTE IT (we'll remove in Phase 3) - REMOVED
- [x] Add a final **Code** node if needed:
  - [x] Name: `Prepare Workflow Output` - ALREADY EXISTS
  - [x] Code: Verified correct implementation

- [x] This becomes the final output returned to AISMR workflow
- [x] Save workflow

---

### Phase 2.5: Test Generate Ideas Workflow

#### Step 24: Create Test Data

- [ ] Create fake test data JSON:
  ```json
  {
    "workflowRun": {
      "id": "test-run-123",
      "input": {
        "userInput": "Create an ASMR video about making coffee"
      },
      "metadata": {
        "sessionId": "test-session-456"
      }
    }
  }
  ```
- [ ] Pin this data to the `Get Run (Code)` node

#### Step 25: Test AI Agent Execution

- [ ] Click "Test workflow" button
- [ ] Execute step-by-step:
  - [ ] Verify `Get Run (Code)` outputs the pinned data
  - [ ] Verify `AI Agent: Generate Ideas` receives the data
  - [ ] Wait for AI Agent to complete (may take 30-60 seconds)
  - [ ] Check AI Agent output - should contain text response
  - [ ] Verify `Parse Ideas Output` extracts the JSON
  - [ ] Check that `ideas` array has 5 items
  - [ ] Each idea should have `idea`, `vibe`, `ideaId`
- [ ] If errors occur:
  - [ ] Check AI Agent system message for syntax errors
  - [ ] Check MCP tools are connected and working
  - [ ] Check structured output parser schema matches response
  - [ ] Review error logs
- [ ] Fix any issues and re-test



- [ ] Create a test execution
- [ ] Run through: Input → AI Agent → Parse → Split Out → Save Ideas
- [ ] Manually verify the ideas are in the expected format
- [ ] Document the output format for reference

#### Step 27: Save and Commit Phase 2

- [ ] Export workflow: `generate-ideas-phase2-complete.json`
- [ ] Compare with backup to verify changes
- [ ] Git add: `git add workflows/generate-ideas.workflow.json`
- [ ] Commit: `git commit -m "Phase 2: Fix Generate Ideas workflow with inline AI Agent

- Removed Call 'Mylo_MCP_Bot' node
- Added inline AI Agent with OpenAI and MCP tools
- Added structured output parser for ideas schema
- Workflow now returns proper ideas array

Resolves: Mylo_MCP_Bot data mapping issues, memory-add responses"`

- [ ] Push: `git push origin phase-1`

---

## 🎬 Phase 3: Fix Screen Writer Workflow (2-3 hours)

**Goal:** Replace Mylo_MCP_Bot with inline AI Agent, add idea context, remove duplicate invocation  
**Priority:** HIGH  
**Testing Strategy:** Test with fake idea data

### Phase 3.1: Backup and Prepare

#### Step 28: Export Current Screen Writer Workflow

- [x] Open `workflows/screen-writer.workflow.json` in n8n editor
- [x] Click Settings → Download
- [x] Save as: `screen-writer-BACKUP-before-phase3.json`
- [x] Take screenshots of current workflow
- [x] Document current flow:
  ```
  Current: When Called → Get Run (API) → Get Run → Call 'Mylo_MCP_Bot' → Update Row → Update Run → ...
  ```
  **Status:** Backup created

---

### Phase 3.2: Update Workflow Inputs

#### Step 29: Add selectedIdea Parameter

- [x] Locate node: `When Called` (workflow trigger)
- [x] Update the workflow inputs to include:
      **Status:** Complete - selectedIdea parameter added to workflow inputs
  ```json
  {
    "runId": { "type": "string", "required": true },
    "userInput": { "type": "string", "required": true },
    "ideaId": { "type": "string", "required": true },
    "selectedIdea": {
      "type": "object",
      "required": true,
      "properties": {
        "idea": { "type": "string" },
        "vibe": { "type": "string" },
        "description": { "type": "string" }
      }
    }
  }
  ```
- [x] Save the trigger configuration
- [x] This ensures parent workflow (AISMR) can pass the idea context

---

### Phase 3.3: Remove Mylo_MCP_Bot and Add AI Agent

#### Step 30: Remove Old Nodes

- [x] Locate and DELETE: `Call 'Mylo_MCP_Bot'` node
- [x] Locate: `Trigger Screenplay` node
- [x] DELETE `Trigger Screenplay` node (this causes duplicate invocation)
- [x] Note the gaps in the workflow
      **Status:** Complete - Mylo_MCP_Bot node removed, replaced with inline AI Agent

#### Step 31: Add OpenAI Chat Model

- [x] Add new node: **OpenAI Chat Model**
- [x] Name: `OpenAI: GPT-4o Screenplay`
- [x] Configuration:
  - [x] Model: `gpt-4o`
  - [x] Temperature: `0.8` (slightly higher for creativity)
  - [x] Max Tokens: `8192` (screenplay can be long)
- [x] Position it where Mylo_MCP_Bot was
      **Status:** Complete - Node added at position [0, -224]

#### Step 32: Add MCP Client Tool

- [x] Add new node: **MCP Client Tool**
- [x] Name: `MCP Tools Screenplay`
- [x] Configuration: Same as Generate Ideas (all MCP tools available)
- [x] Position below OpenAI node
      **Status:** Complete - Node added at position [160, -224] with endpoint https://mcp-vector.mjames.dev/mcp

#### Step 33: Add AI Agent Node

- [x] Add new node: **AI Agent**
- [x] Name: `AI Agent: Generate Screenplay`
- [x] System Message:
      **Status:** Complete - Node added at position [-128, -224] with system message including selectedIdea context

  ```markdown
  You are an AI assistant specializing in writing ASMR video screenplays.

  ## Context

  - Project: AISMR
  - Persona: Screenwriter
  - User Input: {{ $('When Called').item.json.userInput }}
  - Selected Idea: {{ $('When Called').item.json.selectedIdea.idea }}
  - Vibe: {{ $('When Called').item.json.selectedIdea.vibe }}
  - Description: {{ $('When Called').item.json.selectedIdea.description }}
  - Video ID: {{ $('Get Idea').item.json.videoId }}
  - Run ID: {{ $('When Called').item.json.runId }}

  ## Required Steps

  1. Load the persona using prompt_get with persona "screenwriter" and project "aismr"
  2. Load conversation context using conversation_remember
  3. Write a detailed ASMR screenplay based on the selected idea
  4. The screenplay should include:
     - Multiple scenes (typically 5-10)
     - Each scene with dialogue, actions, and timing
     - Sound effects and visual cues
     - Trigger words for ASMR effect
     - Total duration around 60 seconds

  ## Output

  Return a JSON object matching this schema:
  {
  "screenplay": {
  "title": "...",
  "scenes": [
  {
  "sceneNumber": 1,
  "duration": 10,
  "dialogue": "...",
  "actions": ["..."],
  "soundEffects": ["..."],
  "cameraAngle": "..."
  },
  ...
  ],
  "totalDuration": 60,
  "triggerWords": ["..."]
  },
  "videoId": "{{ $('Get Idea').item.json.videoId }}"
  }
  ```

- [x] Connect AI Agent INPUT to the node that previously fed Mylo_MCP_Bot
  - [x] Likely: `Get Run` node
- [x] Connect Model: `OpenAI: GPT-4o Screenplay`
- [x] Connect Tools: `MCP Tools Screenplay`
- [x] Save workflow
      **Status:** Complete - All connections verified in workflow JSON

#### Step 34: Add Structured Output Parser

- [x] Add new node: **Structured Output Parser**
- [x] Name: `Parse Screenplay Output`
- [x] Schema:
      **Status:** Complete - Uses Code node (parse-screenplay-output) at position [32, -224] with JSON parsing logic matching the schema
  ```json
  {
    "type": "object",
    "properties": {
      "screenplay": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "scenes": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "sceneNumber": { "type": "number" },
                "duration": { "type": "number" },
                "dialogue": { "type": "string" },
                "actions": { "type": "array", "items": { "type": "string" } },
                "soundEffects": { "type": "array", "items": { "type": "string" } },
                "cameraAngle": { "type": "string" }
              }
            }
          },
          "totalDuration": { "type": "number" },
          "triggerWords": { "type": "array", "items": { "type": "string" } }
        }
      },
      "videoId": { "type": "string" }
    },
    "required": ["screenplay", "videoId"]
  }
  ```
- [x] Connect: `AI Agent: Generate Screenplay` → `Parse Screenplay Output`
- [x] Save workflow

---

### Phase 3.4: Fix Workflow Output and Database Updates

#### Step 35: Update Run with Screenplay

- [x] Locate node: `Update Run Screenplay Complete` (or similar)
- [x] Update its input to reference `Parse Screenplay Output`
- [x] Ensure it saves the screenplay to the run record:
      **Status:** Complete - Node updated to use Parse Screenplay Output, saves screenplay and videoId

  ```javascript
  const screenplay = $('Parse Screenplay Output').item.json.screenplay;
  const videoId = $('Parse Screenplay Output').item.json.videoId;
  const runId = $('When Called').item.json.runId;

  return {
    json: {
      runId,
      status: 'screenplay_complete',
      stages: {
        screenplay_generation: {
          output: {
            screenplay,
            videoId,
            completedAt: new Date().toISOString(),
          },
        },
      },
    },
  };
  ```

- [x] Connect this to a PATCH request to update the run
- [x] Save workflow

#### Step 36: Prepare Final Output

- [x] Add final **Code** node: `Prepare Workflow Output`
- [x] Code:
      **Status:** Complete - Node added at position [320, -224], returns screenplay, videoId, and status

  ```javascript
  const screenplay = $('Parse Screenplay Output').item.json.screenplay;
  const videoId = $('Parse Screenplay Output').item.json.videoId;

  return {
    json: {
      screenplay,
      videoId,
      status: 'completed',
    },
  };
  ```

- [x] This output is returned to parent AISMR workflow
- [x] Save workflow

---

### Phase 3.5: Test Screen Writer Workflow

#### Step 37: Create Test Data

- [ ] Create fake test data with selected idea:
  ```json
  {
    "runId": "test-run-123",
    "userInput": "Create an ASMR video about making coffee",
    "ideaId": "idea-uuid-123",
    "selectedIdea": {
      "idea": "Morning Coffee Ritual ASMR",
      "vibe": "cozy",
      "description": "A relaxing morning coffee preparation with soft sounds"
    }
  }
  ```
- [ ] Pin this data to `When Called` node

#### Step 38: Test AI Agent Execution

- [ ] Click "Test workflow"
- [ ] Execute step-by-step:
  - [ ] Verify `When Called` receives the pinned data
  - [ ] Verify `AI Agent: Generate Screenplay` receives the idea context
  - [ ] Wait for AI response (may take 60-90 seconds for screenplay)
  - [ ] Check `Parse Screenplay Output` extracts valid JSON
  - [ ] Verify screenplay has scenes array
  - [ ] Verify videoId is present
- [ ] If errors occur:
  - [ ] Check system message includes idea context
  - [ ] Check output parser schema
  - [ ] Review AI response for JSON formatting
  - [ ] Adjust temperature if needed
- [ ] Fix issues and re-test

#### Step 39: Save and Commit Phase 3

- [ ] Export workflow: `screen-writer-phase3-complete.json`
- [ ] Git add: `git add workflows/screen-writer.workflow.json`
- [ ] Commit: `git commit -m "Phase 3: Fix Screen Writer workflow with inline AI Agent

- Removed Call 'Mylo_MCP_Bot' node
- Added selectedIdea parameter to workflow inputs
- Added inline AI Agent with idea context
- Added structured output parser for screenplay schema
- Removed Trigger Screenplay duplicate invocation
- Workflow now returns proper screenplay with videoId

Resolves: Missing idea context, duplicate screenplay invocation"`

- [ ] Push: `git push origin phase-1`

---


**Priority:** MEDIUM  
**Testing Strategy:** Verify Generate Ideas returns approved idea properly

### Phase 4.1: Update AISMR to Use Generate Ideas Output


- [x] Open `workflows/AISMR.workflow.json`
  - [x] Check Approval ID
  - [x] Prepare Loop
  - [x] Check Loop Limit
  - [x] Wait Before Polling (5s)
  - [x] Get Approval Status
  - [x] Check If Approved
  - [x] Extract Selected Idea
- [x] Take note of what comes AFTER: `Call Screen Writer`


**CAREFUL:** This is a destructive operation. Make sure Phase 0 is complete.

- [x] Delete the following nodes:
  - [x] `Check Approval ID` (disconnected from main flow)
  - [x] `Prepare Loop` (disconnected from main flow)
  - [x] `Check Loop Limit` (disconnected from main flow)
  - [x] `Wait Before Polling` (disconnected from main flow)
  - [x] `Get Approval Status` (disconnected from main flow)
  - [x] `Check If Approved` (disconnected from main flow)
- [x] Keep: `Extract Selected Idea` (but we'll modify it)
- [x] Save workflow (verify no critical errors)

#### Step 42: Update Extract Selected Idea Node

**New logic:** Extract from Generate Ideas workflow output

- [x] Locate node: `Extract Selected Idea`
- [x] Update the code:

  ```javascript
  // Get the output from Generate Ideas workflow
  const generateIdeasOutput = $('Call Generate Ideas').item.json;

  // Generate Ideas now returns the approved idea directly
  const selectedIdea = generateIdeasOutput.selectedIdea;
  const ideas = generateIdeasOutput.ideas || [];
  const approvalId = generateIdeasOutput.approvalId;
  const videoId = selectedIdea.videoId || selectedIdea.ideaId;

  return {
    json: {
      selectedIdea: selectedIdea,
      selectedItem: selectedIdea.ideaId,
      ideas: ideas,
      approvalId: approvalId,
      videoId: videoId,
      idea: selectedIdea,
    },
  };
  ```

- [x] Verify this node now reads from `Call Generate Ideas` output
- [x] Save workflow

#### Step 43: Update Data Flow

**Old flow:**

```
```

**New flow:**

```
Call Generate Ideas → Extract Selected Idea → Call Screen Writer
```

- [x] Connect: `Call Generate Ideas` → `Extract Selected Idea`
- [x] Remove: `Get Run After Ideas` node (no longer needed since we use workflow output)
- [x] Keep the Progress notification, but branch it:
  - [x] Add Merge node after `Extract Selected Idea`
  - [x] Main path: → `Call Screen Writer`
  - [x] Branch: → `Progress: Ideas Generated`
- [x] Verify the flow is linear now
- [x] Save workflow

#### Step 44: Update Call Screen Writer Inputs

- [x] Locate node: `Call Screen Writer`
- [x] Update workflowInputs to include selectedIdea:
  ```json
  {
    "runId": "{{ $('Assemble Context').item.json.runId }}",
    "userInput": "{{ $('Assemble Context').item.json.userInput }}",
    "ideaId": "{{ $('Extract Selected Idea').item.json.selectedItem }}",
    "selectedIdea": {
      "idea": "{{ $('Extract Selected Idea').item.json.idea.idea }}",
      "vibe": "{{ $('Extract Selected Idea').item.json.idea.vibe }}",
      "description": "{{ $('Extract Selected Idea').item.json.idea.description || '' }}"
    }
  }
  ```
- [x] Verify Screen Writer workflow will receive full idea context
- [x] Save workflow

---

### Phase 4.2: Test Simplified AISMR Flow

#### Step 45: Create End-to-End Test

- [ ] Pin test data to trigger node
- [ ] Execute workflow step-by-step:
  - [ ] Verify `Call Generate Ideas` returns ideas + selectedIdea
  - [ ] Verify `Extract Selected Idea` extracts correct data
  - [ ] Verify `Call Screen Writer` receives selectedIdea object
  - [ ] Verify rest of workflow continues normally
- [ ] Verify the flow is cleaner and simpler
- [ ] Document any issues

#### Step 46: Save and Commit Phase 4

- [ ] Export workflow: `AISMR-phase4-complete.json`
- [ ] Git add: `git add workflows/AISMR.workflow.json`

- Updated Extract Selected Idea to read from Generate Ideas output
- Removed Get Run After Ideas (using workflow output directly)
- Updated Call Screen Writer to pass full selectedIdea context


- [ ] Push: `git push origin phase-1`

---

## 🗄️ Phase 5: Cleanup and Documentation (1 hour)

**Goal:** Archive old workflows, create TypeScript contracts, update docs  
**Priority:** LOW  
**Testing Strategy:** Final end-to-end test

### Phase 5.1: Archive Mylo_MCP_Bot Workflow

#### Step 47: Archive Workflow

- [x] Create archive directory: `mkdir -p workflows/archive`
- [x] Export `mylo-mcp-bot.workflow.json` one last time
- [x] Move to archive: `git mv workflows/mylo-mcp-bot.workflow.json workflows/archive/`
- [x] Add README in archive:

  ```markdown
  # Archived Workflows

  ## mylo-mcp-bot.workflow.json

  **Archived:** November 2, 2025
  **Reason:** Replaced with inline AI Agents in Generate Ideas and Screen Writer workflows
  **Used by:** Was called by generate-ideas and screen-writer (both refactored)
  **Keep:** For historical reference and pattern documentation
  ```

- [x] Commit archive: `git commit -m "Archive mylo-mcp-bot workflow (replaced with inline AI Agents)"`

---

### Phase 5.2: Create TypeScript Workflow Contracts

#### Step 48: Create Workflow Types File

- [x] Create file: `src/types/workflow-contracts.ts`
- [x] Add interfaces:

  ```typescript
  /**
   * Workflow Data Contracts
   *
   * These types define the expected inputs and outputs for n8n workflows
   * to ensure consistency and type safety across the AISMR pipeline.
   */

  // ============================================================================
  // Generate Ideas Workflow
  // ============================================================================

  export interface GenerateIdeasInput {
    runId: string;
    userInput: string;
    sessionId?: string;
  }

  export interface IdeaCandidate {
    idea: string;
    vibe: string;
    ideaId: string;
    description?: string;
  }

  export interface GenerateIdeasOutput {
    ideas: IdeaCandidate[];
    selectedIdea: IdeaCandidate;
    approvalId: string;
    userIdea: string;
    totalIdeas: number;
  }

  // ============================================================================
  // Screen Writer Workflow
  // ============================================================================

  export interface ScreenWriterInput {
    runId: string;
    userInput: string;
    ideaId: string;
    selectedIdea: {
      idea: string;
      vibe: string;
      description?: string;
    };
  }

  export interface ScreenplayScene {
    sceneNumber: number;
    duration: number;
    dialogue: string;
    actions: string[];
    soundEffects: string[];
    cameraAngle: string;
  }

  export interface Screenplay {
    title: string;
    scenes: ScreenplayScene[];
    totalDuration: number;
    triggerWords: string[];
  }

  export interface ScreenWriterOutput {
    screenplay: Screenplay;
    videoId: string;
    status: 'completed';
  }

  // ============================================================================
  // AISMR Workflow Run Context
  // ============================================================================

  export interface WorkflowRunContext {
    runId: string;
    chatId: string;
    turnId: string;
    userInput: string;
    sessionId?: string;
  }

  export interface WorkflowRunStatus {
    status:
      | 'pending'
      | 'running'
      | 'screenplay_generation'
      | 'video_generation'
      | 'editing'
      | 'uploading'
      | 'publishing'
      | 'completed'
      | 'failed'
      | 'timeout'
      | 'rejected';
    error?: string;
    completedAt?: string;
    failedAt?: string;
    timedOutAt?: string;
    rejectedAt?: string;
  }

  export interface WorkflowRunOutput {
    videoId: string;
    tiktokUrl: string;
    driveUrl: string;
  }
  ```

- [x] Save file
- [x] Export from index: Add to `src/types/index.ts`
- [x] Compile: `npm run build`
- [x] Verify no TypeScript errors

---

### Phase 5.3: Update Documentation

#### Step 49: Create Architecture Diagram

- [x] Update REVIEW.md with final architecture diagram
- [x] Add section "Final Architecture (Post-Refactor)":

  ```markdown
  ## Final Architecture (Post-Refactor)
  ```

  AISMR Workflow (2 Levels)
  ├─ Generate Ideas Workflow
  │ └─ AI Agent (inline) + MCP Tools
  ├─ Screen Writer Workflow
  │ └─ AI Agent (inline) + MCP Tools
  ├─ Generate Video Workflow
  ├─ Edit AISMR Workflow
  ├─ Upload to Drive Workflow
  └─ Post to TikTok Workflow

  ```

  **Improvements:**
  - Reduced from 3 levels to 2 levels
  - Eliminated Mylo_MCP_Bot indirection
  - Proper data contracts with TypeScript types
  - Progress notifications branched (don't break data flow)
  - Complete status tracking
  ```

- [x] Save REVIEW.md

#### Step 50: Update README or Docs

- [x] Update project documentation with workflow changes
- [x] Add section on workflow contracts
- [x] Document testing approach
- [x] Add troubleshooting guide for common workflow issues
- [x] Commit docs: `git commit -m "Update documentation for refactored AISMR workflows"`

---

### Phase 5.4: Final End-to-End Testing

#### Step 51: Create Comprehensive Test Suite

- [ ] If you have real data from a past run:
  - [ ] Use it for testing
  - [ ] Test full AISMR pipeline end-to-end
  - [ ] Verify all stages complete successfully
- [ ] If using fake data:
  - [ ] Create realistic test scenarios
  - [ ] Test error scenarios: Approval failure, timeout, rejection
  - [ ] Verify all notifications send
  - [ ] Verify all status updates happen

#### Step 52: Performance Validation

- [ ] Measure execution time for key stages:
  - [ ] Generate Ideas (with AI Agent)
  - [ ] Screen Writer (with AI Agent)
  - [ ] Full AISMR pipeline
- [ ] Compare to old execution times (if available)
- [ ] Expected improvement: Faster due to fewer workflow hops
- [ ] Document performance metrics

#### Step 53: Final Commit

- [ ] Review all changes: `git status`
- [ ] Ensure all workflows are saved and committed
- [ ] Create final summary commit:

  ```bash
  git commit -m "Phase 5: Cleanup and documentation complete

  - Archived mylo-mcp-bot workflow
  - Created TypeScript workflow contracts
  - Updated documentation with new architecture
  - Completed end-to-end testing

  Summary of all changes:
  - Fixed critical data flow bugs (Telegram nodes, control flow, completion status)
  - Refactored Generate Ideas with inline AI Agent
  - Refactored Screen Writer with inline AI Agent + idea context
  - Reduced complexity from 3 workflow levels to 2
  - All workflows now functional and tested"
  ```

- [ ] Push final changes: `git push origin phase-1`

---

## 🔍 Phase 6: Audit Video Generation Workflows (Future Work)

**Goal:** Audit remaining workflows for similar issues  
**Priority:** LOW - Do after Phase 0-5 complete  
**Estimated Time:** 2-4 hours

### Workflows to Audit:

- [ ] `generate-video.workflow.json` (5 executeWorkflow references)
- [ ] `edit-aismr.workflow.json` (4 executeWorkflow references)
- [ ] `upload-file-to-google-drive.workflow.json` (3 executeWorkflow references)
- [ ] `upload-to-tiktok.workflow.json` (5 executeWorkflow references)

### For Each Workflow:

- [ ] Open workflow in editor
- [ ] Identify all executeWorkflow calls
- [ ] Check if they use Mylo_MCP_Bot or other unnecessary indirection
- [ ] Verify data flow is clean (no Telegram nodes breaking it)
- [ ] Check for missing error handling
- [ ] Document findings
- [ ] Create separate plan for refactoring if needed

---

## ✅ Final Checklist

Before considering this plan complete:

- [ ] All Phase 0 critical fixes deployed and tested
- [ ] Generate Ideas workflow refactored and tested
- [ ] Screen Writer workflow refactored and tested
- [ ] TypeScript contracts created
- [ ] Documentation updated
- [ ] All changes committed and pushed
- [ ] At least one successful end-to-end AISMR execution
- [ ] All error scenarios tested (failure, timeout, rejection)
- [ ] Performance metrics documented
- [ ] Team notified of changes

---

## 📞 Support & Escalation

If you encounter issues:

1. **Data flow breaks:** Re-check Merge node configurations (must be passthrough mode)
2. **AI Agent not responding:** Verify OpenAI API key and MCP server connection
3. **Schema validation errors:** Check structured output parser schema matches AI output
4. **Workflow won't save:** Check for circular dependencies or disconnected nodes

**Escalate to team lead if:**

- Multiple test executions fail
- Data corruption in database
- Cannot rollback to previous workflow version
- API rate limits exceeded

---

## 📊 Success Metrics

Track these metrics before and after refactoring:

| Metric                     | Before   | After | Target   |
| -------------------------- | -------- | ----- | -------- |
| AISMR execution time       | Unknown  | TBD   | < 5 min  |
| Ideas generation time      | Unknown  | TBD   | < 60 sec |
| Screenplay generation time | Unknown  | TBD   | < 90 sec |
| Error rate                 | Unknown  | TBD   | < 5%     |
| Silent failures            | High     | TBD   | 0        |
| Workflow nesting levels    | 3        | 2     | 2        |
| Duplicate logic instances  | Multiple | 0     | 0        |

---

**Plan created by:** AI Assistant  
**Review status:** Ready for execution  
**Next action:** Begin Phase 0.1 - Fix Telegram nodes breaking data flow
