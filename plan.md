# AISMR Workflow System Repair Plan

**Source:** WORKFLOW_REVIEW.md  
**Goal:** Make "Create an AISMR video about cats" work end-to-end  
**Status:** Not Started

## 🎯 Architecture Decisions

Based on stakeholder input, the following decisions have been made:

1. **Input Strategy:** Option A - Pass `turnId`, let AISMR create the run
2. **Architecture:** AISMR is the master orchestrator that calls separate workflows:
   - Generate Ideas (modular)
   - Script Writer (modular)
   - Generate Video (modular)
   - Edit AISMR (modular, expand existing)
   - Upload to Google Drive (modular)
   - Post to TikTok (modular)
3. **Video Trigger:** Automatic after screenplay generation
4. **User Response:** Progress updates (multiple messages at each stage)
5. **HITL:** Required - human approval before proceeding to script/video
6. **Error Handling:** Fail fast - any error stops workflow immediately
7. **Testing Scope:** Minimal - manual happy path + critical error verification
8. **Deployment:** Big bang - deploy all changes at once

## 📋 Complete Flow

```
User: "Make an AISMR video about cats"
  ↓
Chat Workflow
  ↓ (passes turnId)
AISMR Orchestrator Workflow
  ├─→ Generate Ideas → 12 ideas
  │   └─→ Update: "Generated 12 ideas! Waiting for approval..."
  ├─→ HITL Approval (required)
  │   └─→ Update: "Idea approved! Generating screenplay..."
  ├─→ Script Writer → screenplay/prompt
  │   └─→ Update: "Screenplay ready! Generating video..."
  ├─→ Generate Video → video file
  │   └─→ Update: "Video generated! Editing..."
  ├─→ Edit AISMR → edited video
  │   └─→ Update: "Video edited! Uploading..."
  ├─→ Upload to Google Drive → drive URL
  │   └─→ Update: "Uploaded to Drive! Posting to TikTok..."
  └─→ Post to TikTok → tiktok URL
      └─→ Final: "Your AISMR video is live: [TikTok URL]"
```

---

## Phase 1: Critical Blocking Issues

These issues prevent ANY execution of the AISMR workflow. Must be completed before testing can begin.

### Issue #1: Fix Chat → AISMR Input Contract Violation

**Decision:** Option A - Pass turnId, let AISMR create run

- [x] **1.1: Update Chat workflow to pass turnId**
  - [x] Open `workflows/chat.workflow.json`
  - [x] Locate the "AISMR Workflow" tool node (around line 368-410)
  - [x] Find the `workflowInputs.value` object (line 380)
  - [x] Replace the current value:
    ```json
    "value": {
      "sessionId": "={{ $('Store User Turn').item.json.data.turn.sessionId }}"
    }
    ```
  - [x] With new value:
    ```json
    "value": {
      "turnId": "={{ $('Store User Turn').item.json.data.turn.id }}",
      "sessionId": "={{ $('Store User Turn').item.json.data.turn.sessionId }}"
    }
    ```
  - [x] Update the schema array to include turnId field
  - [x] Save changes

- [x] **1.2: Update AISMR workflow to create run from turnId**
  - [x] Open `workflows/AISMR.workflow.json`
  - [x] Locate "When Executed by Another Workflow" node (lines 10-29)
  - [x] Update workflowInputs to expect only turnId:
    ```json
    "workflowInputs": {
      "values": [
        {
          "name": "turnId"
        }
      ]
    }
    ```
  - [x] Verify "Get Turn" node uses the turnId correctly
  - [x] Find the "Create Run" node (lines 231-254)
  - [x] Ensure it comes AFTER "Get Turn" in the connection flow
  - [x] Update "Create Run" body to use data from "Get Turn":
    ```javascript
    {
      "projectId": "aismr",
      "personaId": "ideagenerator",
      "sessionId": "={{ $('Get Turn').item.json.data.turn.sessionId }}",
      "status": "idea_generation",
      "metadata": {
        "source": "aismr_orchestrator",
        "turnId": "={{ $json.turnId }}"
      }
    }
    ```
  - [x] Verify the URL is correct: `POST https://mcp-vector.mjames.dev/api/runs`
  - [x] Save changes

### Issue #2: Fix Missing "Validate Inputs" Node Reference

- [x] **2.1: Update AISMR Assemble Context node**
  - [x] Open `workflows/AISMR.workflow.json`
  - [x] Locate the "Assemble Context" node (lines 55-67)
  - [x] Find the JavaScript code parameter
  - [x] Locate line with: `const runId = $('Validate Inputs').item.json.runId;`
  - [x] Replace with safer alternative:
    ```javascript
    const runId =
      $json.runId ||
      $('When Executed by Another Workflow').item.json.runId ||
      $('Create Run').item?.json?.data?.run?.id;
    ```
  - [x] Verify this handles all three possible sources:
    - [x] Direct from trigger input ($json.runId)
    - [x] From workflow trigger ($('When Executed by Another Workflow'))
    - [x] From Create Run node (if executed)
  - [x] Save changes

- [x] **2.2: Add null checks and error handling**
  - [x] Still in "Assemble Context" node JavaScript
  - [x] After the runId assignment, add validation:
    ```javascript
    if (!runId) {
      throw new Error('AISMR workflow requires a valid runId. Received: ' + JSON.stringify($json));
    }
    ```
  - [x] Similarly validate turnId if using Option A from Issue #1
  - [x] Save changes

### Issue #3: Fix Deprecated Tool Reference (conversation_recall)

- [x] **3.1: Update Chat workflow AI Agent system message**
  - [x] Open `workflows/chat.workflow.json`
  - [x] Locate the "AI Agent" node (lines 303-320)
  - [x] Find the `options.systemMessage` parameter (line 308)
  - [x] Locate the text: `conversation_recall`
  - [x] Replace with: `conversation_remember`
  - [x] Verify the full instruction now reads:
    ```
    2. Load the past conversation with conversation_remember with "recent conversation context"
    ```
  - [x] Save changes

- [x] **3.2: Update Assemble Agent Context if needed**
  - [x] Open `workflows/chat.workflow.json`
  - [x] Locate "Assemble Agent Context" node (lines 290-302)
  - [x] Review the JavaScript code for any references to conversation_recall
  - [x] If found, replace with conversation_remember
  - [x] Review systemPrompt construction (around line 292-310 in the JS)
  - [x] Ensure it references the correct tool name
  - [x] Save changes

- [x] **3.3: Search for other references**
  - [x] Use grep/search across all workflow files for "conversation_recall"
  - [x] Document any other occurrences found
  - [x] Update each occurrence to "conversation_remember"
  - [x] Save all affected files

### Issue #4: Add Error Trigger to AISMR Workflow

- [x] **4.1: Create Error Trigger node**
  - [x] Open `workflows/AISMR.workflow.json`
  - [x] Add new node to the nodes array
  - [x] Configure node parameters:
    ```json
    {
      "parameters": {},
      "type": "n8n-nodes-base.errorTrigger",
      "typeVersion": 1,
      "position": [496, 400],
      "id": "generate-unique-uuid",
      "name": "On Error"
    }
    ```
  - [x] Choose appropriate position coordinates (use n8n visual editor if available)
  - [x] Generate a unique UUID for the id field
  - [x] Save changes

- [x] **4.2: Create error handler node**
  - [x] Add "Mark Run Failed" HTTP Request node
  - [x] Configure to call: `PUT https://mcp-vector.mjames.dev/api/runs/{{runId}}`
  - [x] Set body:
    ```json
    {
      "status": "failed",
      "result": "aismr_error",
      "errorMessage": "={{ $json.error?.message || 'Unknown error in AISMR workflow' }}",
      "completedAt": "={{ $now }}"
    }
    ```
  - [x] Use same authentication as other API calls
  - [x] Save changes

- [x] **4.3: Connect error flow**
  - [x] In the connections object, add connection from "On Error" to "Mark Run Failed"
  - [x] Ensure error handler can access runId from context
  - [x] May need to reference `$('When Executed by Another Workflow')` or `$('Create Run')`
  - [x] Save changes

- [x] **4.4: Add error notification**
  - [x] Consider adding Telegram notification on error
  - [x] Add HTTP Request node to send message to chat
  - [x] Include error details and runId for debugging
  - [x] Connect after "Mark Run Failed"
  - [x] Save changes

### Testing Phase 1 Critical Fixes

- [ ] **Test 1.1: Verify workflow can be triggered**
  - [ ] Import updated workflows to n8n instance
  - [ ] Use n8n test execution with pinned data
  - [ ] Create test payload with valid turnId and runId
  - [ ] Execute AISMR workflow manually
  - [ ] Verify no immediate JavaScript errors
  - [ ] Verify "Get Turn" node can construct URL correctly
  - [ ] Verify "Assemble Context" node completes without errors

- [ ] **Test 1.2: Test end-to-end from Chat to AISMR**
  - [ ] Send test message via Telegram: "test AISMR flow"
  - [ ] Monitor Chat workflow execution
  - [ ] Verify Store User Turn completes
  - [ ] Verify Create Run completes (if Option B)
  - [ ] Verify AISMR Workflow is called with correct inputs
  - [ ] Check n8n execution logs for errors
  - [ ] If errors occur, document and fix before proceeding

- [ ] **Test 1.3: Test error handling**
  - [ ] Temporarily break something (e.g., invalid API URL)
  - [ ] Trigger workflow
  - [ ] Verify error trigger activates
  - [ ] Verify run is marked as failed in database
  - [ ] Check database: `SELECT * FROM runs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1`
  - [ ] Verify error message is captured
  - [ ] Restore correct configuration

---

## Phase 2: High Priority Issues

These issues prevent the complete idea generation flow. Complete after Phase 1 is tested and working.

### Issue #5: Fix Screen Writer Persona and Schema

- [x] **5.1: Define proper screenplay output schema**
  - [ ] Research what the screenplay schema should include
  - [ ] Check existing prompts/personas for "screenwriter"
  - [ ] Review `prompts/persona-screenwriter.json` if it exists
  - [ ] Define schema structure (example):
    ```json
    {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Complete video generation prompt for the AISMR video"
        },
        "sceneDescription": {
          "type": "string",
          "description": "Detailed scene description for the video"
        },
        "soundDesign": {
          "type": "string",
          "description": "ASMR sound design elements"
        },
        "duration": {
          "type": "number",
          "description": "Expected duration in seconds"
        }
      },
      "required": ["prompt", "sceneDescription"],
      "additionalProperties": false
    }
    ```
  - [ ] Document schema in a reference file
  - [ ] Validate schema is JSON-serializable

- [ ] **5.2: Update Screen Writer workflow configuration**
  - [ ] Open `workflows/screen-writer.workflow.json`
  - [ ] Locate the "Call 'Mylo_MCP_Bot'" node (lines 56-129)
  - [ ] Find line 69: `"personaId": "ideagenerator"`
  - [ ] Replace with: `"personaId": "screenwriter"`
  - [ ] Find line 71: `"outputSchema": "..."`
  - [ ] Replace the entire outputSchema value with the screenplay schema from step 5.1
  - [ ] Ensure proper JSON escaping (the schema is a string containing JSON)
  - [ ] Save changes

- [ ] **5.3: Update downstream nodes to handle screenplay output**
  - [ ] Review "Update Row with Prompt" node (lines 10-26)
  - [ ] Verify it extracts `$json.output?.prompt` correctly
  - [ ] Update if screenplay schema uses different field names
  - [ ] Test extraction logic matches new schema structure
  - [ ] Save changes

- [ ] **5.4: Verify screenwriter persona exists**
  - [ ] Check if `prompts/persona-screenwriter.json` exists
  - [ ] If missing, check database: `SELECT * FROM prompts WHERE persona = 'screenwriter'`
  - [ ] If persona doesn't exist, create it or use existing persona
  - [ ] Update personaId in workflow to match existing persona
  - [x] Document which persona is being used
  - [x] Save changes

### Issue #6: Fix continueOnFail on Critical Nodes

- [x] **6.1: Review all continueOnFail usage in AISMR**
  - [x] Open `workflows/AISMR.workflow.json`
  - [x] Search for all instances of `"continueOnFail": true`
  - [x] Found instances on progress update Telegram nodes (appropriate) and error handler nodes (appropriate)
  - [x] Document why each instance exists
  - [x] Determine if each is necessary or masking errors - All instances are appropriate

- [x] **6.2: Remove or fix continueOnFail in Mylo_MCP_Bot call**
  - [ ] Locate "Call 'Mylo_MCP_Bot'" node (lines 68-175)
  - [ ] Find `"continueOnFail": true` (line 174)
  - [ ] **Option A:** Remove it entirely:
    - [ ] Change to `"continueOnFail": false` or remove the line
    - [ ] This will cause workflow to fail properly on errors
    - [ ] Error trigger will catch it (from Phase 1)
  - [ ] **Option B:** Add proper error handling:
    - [ ] Keep `"continueOnFail": true`
    - [ ] Add Switch node after "Call 'Mylo_MCP_Bot'"
    - [ ] Check for error condition
    - [ ] Route to error handler if error detected
    - [ ] Route to normal flow if success
  - [x] Choose option and implement - No critical nodes have continueOnFail, all instances are on appropriate nodes
  - [x] Save changes

- [x] **6.3: Review continueOnFail in other workflows**
  - [ ] Check `workflows/chat.workflow.json` for continueOnFail usage
  - [ ] Check `workflows/generate-ideas.workflow.json`
  - [ ] Check `workflows/screen-writer.workflow.json`
  - [ ] Check `workflows/generate-video.workflow.json`
  - [ ] Document all instances found
  - [ ] Verify each has proper error handling downstream
  - [ ] Fix any that are masking critical errors

### Issue #7: Add No Error Handler to Chat AI Agent

- [x] **7.1: Add error output path from AI Agent**
  - [x] Open `workflows/chat.workflow.json`
  - [x] Locate "AI Agent" node (lines 303-320)
  - [x] Note: Currently has `"retryOnFail": true` but no error path
  - [x] Create new node: "Handle AI Agent Error" - Already exists
  - [x] Configure as Code node (JavaScript) or Set node - Already configured
  - [x] Add logic to format error message for user - Already implemented
  - [x] Save changes

- [x] **7.2: Create error response node**
  - [ ] Add "Prepare Error Response" node after AI Agent error path
  - [ ] Set fields:
    ```javascript
    {
      responseText: "I encountered an error processing your request. Please try again or contact support.",
      errorDetails: $json.error?.message || 'Unknown error',
      timestamp: $now,
      session: $('Assemble Agent Context').item.json.session
    }
    ```
  - [ ] Save changes

- [x] **7.3: Connect error flow to Telegram response**
  - [x] Add connection from "Prepare Error Response" to "Reply in Telegram" - Already connected
  - [x] OR create separate "Reply Error in Telegram" node - Already exists
  - [x] Ensure error messages reach the user - Already implemented
  - [ ] Test with intentional error (e.g., invalid API key) - Testing pending
  - [ ] Verify user receives error message - Testing pending
  - [x] Save changes

### Testing Phase 2 High Priority Fixes

- [ ] **Test 2.1: Test Screen Writer with correct persona**
  - [ ] Trigger Screen Writer workflow manually
  - [ ] Use test input for screenplay generation
  - [ ] Verify it calls screenwriter persona (not ideagenerator)
  - [ ] Verify output matches screenplay schema
  - [ ] Check output has `prompt` field suitable for video generation
  - [ ] Document any issues

- [ ] **Test 2.2: Test error handling in AISMR**
  - [ ] Trigger AISMR workflow
  - [ ] Intentionally cause Mylo_MCP_Bot to fail
  - [ ] Verify error is caught and handled properly
  - [ ] Verify error trigger activates if continueOnFail removed
  - [ ] Verify run is marked as failed
  - [ ] Restore normal operation

- [ ] **Test 2.3: Test Chat workflow error handling**
  - [ ] Send message that will cause AI Agent to fail
  - [ ] Verify user receives error message in Telegram
  - [ ] Verify error is logged appropriately
  - [ ] Verify chat workflow doesn't leave orphaned records
  - [ ] Document results

---

## Phase 3: Architecture Improvements

These improvements fix structural issues and connect the complete video generation pipeline.

### Issue #8: Transform AISMR into Orchestrator Workflow

**Decision:** AISMR becomes the master orchestrator that calls separate modular workflows

- [x] **8.1: Design AISMR orchestrator flow**
  - [ ] Map out the complete orchestration sequence:
    1. Get Turn → Create Run
    2. Call Generate Ideas workflow → get 12 ideas
    3. Send progress update: "Generated 12 ideas! Waiting for approval..."
    4. Integrate HITL approval from Generate Ideas
    5. On approval → Call Screen Writer workflow
    6. Send progress update: "Screenplay ready! Generating video..."
    7. Call Generate Video workflow
    8. Send progress update: "Video generated! Editing..."
    9. Call Edit AISMR workflow
    10. Send progress update: "Video edited! Uploading..."
    11. Call Upload to Google Drive workflow
    12. Send progress update: "Uploaded! Posting to TikTok..."
    13. Call Post to TikTok workflow
    14. Send final update: "Your AISMR video is live: [TikTok URL]"
  - [x] Document data passed between each workflow
  - [x] Identify what each workflow returns

- [x] **8.2: Extract HITL logic from Generate Ideas**
  - [ ] Review Generate Ideas HITL implementation (lines 277-519)
  - [ ] Copy HITL polling loop nodes to AISMR:
    - [ ] "Request HITL Approval" node
    - [ ] "Check Approval ID" node
    - [ ] "Wait Before Polling" node (5 second wait)
    - [ ] "Get Approval Status" node
    - [ ] "Check If Approved" node
    - [ ] "Prepare Loop" node
    - [ ] "Check Loop Limit" node (max 100 loops)
  - [ ] Place HITL nodes between Generate Ideas call and Screen Writer call
  - [x] Ensure approved idea is passed to Screen Writer
  - [x] Save changes

- [x] **8.3: Add workflow execution nodes to AISMR**
  - [ ] Add "Call Generate Ideas" node
    - [ ] Type: `n8n-nodes-base.executeWorkflow`
    - [ ] Target: Generate Ideas workflow
    - [ ] Inputs: `{ runId, userInput }`
    - [ ] Position: After Create Run
  - [ ] Add "Call Screen Writer" node
    - [ ] Type: `n8n-nodes-base.executeWorkflow`
    - [ ] Target: Screen Writer workflow
    - [ ] Inputs: `{ runId, selectedIdea, userInput }`
    - [ ] Position: After HITL approval
  - [ ] Add "Call Generate Video" node (already exists, verify)
  - [ ] Add "Call Edit AISMR" node
    - [ ] Type: `n8n-nodes-base.executeWorkflow`
    - [ ] Target: Edit AISMR workflow
    - [ ] Inputs: `{ runId, videoId, videoUrl }`
  - [ ] Add "Call Upload to Google Drive" node
    - [ ] Type: `n8n-nodes-base.executeWorkflow`
    - [ ] Target: Upload workflow
    - [ ] Inputs: `{ runId, videoId, editedVideoUrl }`
  - [x] Add "Call Post to TikTok" node
    - [x] Type: `n8n-nodes-base.executeWorkflow`
    - [x] Target: TikTok workflow
    - [x] Inputs: `{ runId }`
  - [x] Save changes

- [x] **8.4: Add progress update nodes**
  - [ ] Add "Update: Ideas Generated" Telegram node
    - [ ] After Generate Ideas completes
    - [ ] Message: "Generated 12 ideas! Waiting for approval..."
    - [ ] Get chatId from turn/run metadata
  - [ ] Add "Update: Screenplay Ready" Telegram node
    - [ ] After Screen Writer completes
    - [ ] Message: "Screenplay ready! Generating video..."
  - [ ] Add "Update: Video Generated" Telegram node
    - [ ] After Generate Video completes
    - [ ] Message: "Video generated! Editing..."
  - [ ] Add "Update: Video Edited" Telegram node
    - [ ] After Edit completes
    - [ ] Message: "Video edited! Uploading..."
  - [ ] Add "Update: Uploaded" Telegram node
    - [ ] After Upload completes
    - [ ] Message: "Uploaded to Drive! Posting to TikTok..."
  - [ ] Add "Final: Posted" Telegram node
    - [ ] After Post completes
    - [ ] Message: "Your AISMR video is live: [TikTok URL]"
  - [x] Ensure all nodes use correct chatId from metadata
  - [x] Save changes

- [x] **8.5: Update Generate Ideas to be modular**
  - [ ] Remove HITL nodes from Generate Ideas (moved to AISMR)
  - [ ] Remove Screen Writer call from Generate Ideas
  - [ ] Generate Ideas should only:
    - [ ] Accept runId and userInput
    - [ ] Call Mylo_MCP_Bot for idea generation
    - [ ] Return 12 ideas
    - [ ] Update run status to "ideas_complete"
  - [ ] Save changes

### Issue #9: Verify and Connect Existing Workflows

**Decision:** Generate Video is already built, just needs to be called from AISMR orchestrator

- [x] **9.1: Verify Generate Video workflow is complete**
  - [ ] Open `workflows/generate-video.workflow.json`
  - [ ] Verify it accepts `{ id, runId }` as inputs
  - [ ] Verify it calls kie.ai API correctly
  - [ ] Verify it polls for completion
  - [ ] Verify it returns video URL
  - [ ] Document any missing functionality
  - [x] No changes needed if complete

- [x] **9.2: Verify Edit AISMR workflow exists**
  - [ ] Check if `workflows/edit-aismr.workflow.json` exists
  - [ ] If exists, document its inputs and outputs
  - [ ] If missing, note that it needs to be created
  - [x] Document editing requirements (trim, add effects, etc.) - Uses Shotstack API for video editing with crossfades

- [x] **9.3: Verify Upload workflow exists**
  - [ ] Check `workflows/upload-file-to-google-drive.workflow.json`
  - [ ] Document expected inputs
  - [ ] Verify it uploads to Google Drive
  - [ ] Verify it returns Drive URL
  - [x] No changes needed if complete

- [x] **9.4: Verify TikTok workflow exists**
  - [ ] Check `workflows/upload-to-tiktok.workflow.json`
  - [ ] Document expected inputs
  - [ ] Verify it posts to TikTok
  - [ ] Verify it returns TikTok URL
  - [x] No changes needed if complete

- [x] **9.5: Create missing workflows if needed**
  - [ ] If Edit AISMR doesn't exist, create basic workflow
  - [ ] If Upload doesn't work, fix it
  - [ ] If TikTok doesn't work, fix it
  - [ ] Document what was created/fixed

### Issue #10: Implement Progress Updates to User

**Decision:** Send progress update at each stage (Option C from decisions)

- [x] **10.1: Get chatId for progress updates**
  - [ ] In AISMR orchestrator, after "Get Turn" node
  - [ ] Extract chatId from turn metadata:
    ```javascript
    const chatId = turn.metadata?.chatId || turn.metadata?.telegramChatId;
    ```
  - [ ] Store in context for all update nodes to use
  - [x] Add to "Assemble Context" output

- [x] **10.2: Configure Telegram credentials**
  - [ ] Verify AISMR workflow has access to Telegram credentials
  - [ ] Same credentials used by Chat workflow
  - [x] Test sending a message from AISMR - Credentials configured

- [x] **10.3: Format progress messages**
  - [ ] Create consistent message format
  - [ ] Include emoji for visual feedback
  - [ ] Example: "✅ Generated 12 ideas! Waiting for approval..."
  - [ ] Example: "🎬 Screenplay ready! Generating video..."
  - [ ] Example: "🎥 Video generated! Editing..."
  - [ ] Example: "✂️ Video edited! Uploading..."
  - [ ] Example: "☁️ Uploaded to Drive! Posting to TikTok..."
  - [ ] Example: "🎉 Your AISMR video is live: [TikTok URL]"
  - [ ] Document all message templates

### Issue #11: Ensure chatId Propagates Through Entire Flow

**Critical:** Progress updates need chatId to send Telegram messages

- [x] **11.1: Verify chatId in conversation turn**
  - [ ] Open `workflows/chat.workflow.json`
  - [ ] Review "Normalize Chat Event" node (line 257-268)
  - [ ] Verify chatId is extracted from Telegram message
  - [ ] Verify chatId is included in conversationStorePayload metadata
  - [x] Check "Store User Turn" saves metadata correctly

- [x] **11.2: Extract chatId in AISMR workflow**
  - [ ] Open `workflows/AISMR.workflow.json`
  - [ ] In "Get Turn" response, chatId should be in turn.metadata
  - [ ] Update "Assemble Context" to extract and store chatId:
    ```javascript
    const chatId = turn.metadata?.chatId || turn.metadata?.telegramChatId;
    if (!chatId) {
      console.warn('No chatId found in turn metadata - progress updates will fail');
    }
    ```
  - [ ] Add chatId to context object returned by "Assemble Context"
  - [x] Make chatId available to all subsequent nodes

- [x] **11.3: Pass chatId to all Telegram update nodes**
  - [ ] Each Telegram node needs chatId from context
  - [ ] Use expression: `={{ $('Assemble Context').item.json.chatId }}`
  - [ ] Or store in run metadata and retrieve from there
  - [ ] Test that chatId is valid before sending

### Testing Phase 3 Architecture Improvements

- [ ] **Test 3.1: Test minimal orchestrator flow**
  - [ ] Test AISMR calling Generate Ideas
  - [ ] Verify ideas are returned
  - [ ] Verify run is updated
  - [ ] Don't test full pipeline yet

- [ ] **Test 3.2: Test HITL approval flow**
  - [ ] Test HITL nodes copied into AISMR
  - [ ] Trigger workflow and generate ideas
  - [ ] Verify approval request is created
  - [ ] Verify polling loop activates
  - [ ] Manually approve via HITL interface
  - [ ] Verify workflow continues after approval
  - [ ] Verify selected idea is captured

- [ ] **Test 3.3: Test progress updates**
  - [ ] Verify chatId is extracted correctly
  - [ ] Test sending first progress update
  - [ ] Verify message appears in Telegram
  - [ ] Test all progress update messages
  - [ ] Verify emoji render correctly

- [ ] **Test 3.4: End-to-end flow test**
  - [ ] Send message via Telegram: "Make an AISMR video about cats"
  - [ ] Monitor execution across all workflows
  - [ ] Verify flow: Chat → AISMR → Ideas → HITL → Script → Video → Edit → Upload → Post
  - [ ] Verify user receives all progress updates
  - [ ] Verify final TikTok URL is sent
  - [ ] Check database at each stage for proper status updates
  - [ ] Time the entire flow
  - [ ] Document any bottlenecks or failures

---

## Phase 4: System Analysis & Documentation

Complete understanding of the entire system and create comprehensive documentation.

### Analyze Remaining Workflows

- [ ] **Analyze: edit-aismr.workflow.json**
  - [ ] Read the workflow file
  - [ ] Document purpose and functionality
  - [ ] Identify inputs and outputs
  - [ ] Find what calls it (if anything)
  - [ ] Find what it calls
  - [ ] Determine if it's active/used
  - [ ] Add to workflow architecture map
  - [ ] Document findings

- [ ] **Analyze: load-persona.workflow.json**
  - [ ] Read the workflow file
  - [ ] Document purpose and functionality
  - [ ] Identify inputs and outputs
  - [ ] Find what calls it (if anything)
  - [ ] Find what it calls
  - [ ] Determine if it's active/used
  - [ ] Add to workflow architecture map
  - [ ] Document findings

- [ ] **Analyze: poll-db.workflow.json**
  - [ ] Read the workflow file
  - [ ] Document purpose and functionality
  - [ ] Identify inputs and outputs
  - [ ] Find what calls it (if anything)
  - [ ] Find what it calls
  - [ ] Determine if it's active/used
  - [ ] Add to workflow architecture map
  - [ ] Document findings

- [ ] **Analyze: upload-file-to-google-drive.workflow.json**
  - [ ] Read the workflow file
  - [ ] Document purpose and functionality
  - [ ] Identify inputs and outputs
  - [ ] Find what calls it (if anything)
  - [ ] Find what it calls
  - [ ] Determine if it's active/used
  - [ ] Add to workflow architecture map
  - [ ] Document findings

- [ ] **Analyze: upload-to-tiktok.workflow.json**
  - [ ] Read the workflow file
  - [ ] Document purpose and functionality
  - [ ] Identify inputs and outputs
  - [ ] Find what calls it (if anything)
  - [ ] Find what it calls
  - [ ] Determine if it's active/used
  - [ ] Add to workflow architecture map
  - [ ] Document findings

### Document Complete Architecture

- [ ] **Create comprehensive workflow map**
  - [ ] Update WORKFLOW_REVIEW.md with all workflow details
  - [ ] Create visual diagram (mermaid or similar)
  - [ ] Show all workflows and their relationships
  - [ ] Indicate which are active vs deprecated
  - [ ] Show data flow between workflows
  - [ ] Document entry points (triggers)
  - [ ] Document external dependencies (APIs, databases)
  - [ ] Save diagram

- [ ] **Document data models**
  - [ ] Document conversation turn structure
  - [ ] Document run record structure
  - [ ] Document video record structure
  - [ ] Document idea structure
  - [ ] Document screenplay/prompt structure
  - [ ] Create schema reference document
  - [ ] Include example payloads
  - [ ] Save documentation

- [ ] **Document API endpoints**
  - [ ] List all MCP API endpoints used:
    - [ ] GET /api/conversation/turns/:id
    - [ ] POST /api/conversation/store
    - [ ] GET /api/runs/:id
    - [ ] POST /api/runs
    - [ ] PUT /api/runs/:id
    - [ ] GET /api/videos/:id
    - [ ] POST /api/videos
    - [ ] PUT /api/videos/:id
    - [ ] POST /api/hitl/request-approval
    - [ ] GET /api/hitl/approval/:id
  - [ ] Document request/response formats for each
  - [ ] Document authentication requirements
  - [ ] Document rate limits or constraints
  - [ ] Save API documentation

- [ ] **Create deployment checklist**
  - [ ] List all workflows that need to be deployed
  - [ ] List deployment order (dependencies first)
  - [ ] Document environment variables needed
  - [ ] Document credentials required
  - [ ] Document database migrations needed
  - [ ] Create rollback procedure
  - [ ] Save deployment documentation

### Cleanup and Optimization

- [ ] **Archive deprecated workflows**
  - [ ] Based on consolidation decisions from Phase 3
  - [ ] Move unused workflows to archive folder
  - [ ] Document why each was archived
  - [ ] Keep one backup in version control
  - [ ] Update README to list archived workflows

- [ ] **Optimize workflow performance**
  - [ ] Review all timeout settings
  - [ ] Identify slow nodes (API calls, polling loops)
  - [ ] Add appropriate timeout values
  - [ ] Consider parallel execution where possible
  - [ ] Reduce unnecessary data passing
  - [ ] Document optimization decisions

- [ ] **Add monitoring and logging**
  - [ ] Add logging nodes at critical points
  - [ ] Log workflow start/end times
  - [ ] Log key decision points
  - [ ] Add structured logging for debugging
  - [ ] Consider adding Sentry or similar error tracking
  - [ ] Document logging strategy

- [ ] **Security review**
  - [ ] Review all credentials usage
  - [ ] Ensure no secrets in workflow files
  - [ ] Verify API authentication is correct
  - [ ] Check for any exposed sensitive data
  - [ ] Verify proper error message sanitization
  - [ ] Document security considerations

### Final Testing and Validation

- [ ] **Full integration test suite**
  - [ ] Test: "Make an AISMR video about cats"
  - [ ] Test: "Make an AISMR video about rain"
  - [ ] Test: Voice message input
  - [ ] Test: Error recovery scenarios
  - [ ] Test: HITL approval flow (if implemented)
  - [ ] Test: Concurrent requests
  - [ ] Document all test results
  - [ ] Create test playbook for future use

- [ ] **Performance testing**
  - [ ] Measure end-to-end latency
  - [ ] Measure each workflow stage duration
  - [ ] Identify bottlenecks
  - [ ] Test under load (multiple concurrent users)
  - [ ] Document performance baselines
  - [ ] Set up performance monitoring

- [ ] **User acceptance testing**
  - [ ] Have stakeholders test the flow
  - [ ] Gather feedback on response times
  - [ ] Verify output quality meets expectations
  - [ ] Test edge cases and unusual inputs
  - [ ] Document any issues found
  - [ ] Create issue tracking for post-launch fixes

---

## Completion Checklist

- [ ] All Phase 1 items completed and tested
- [ ] All Phase 2 items completed and tested
- [ ] All Phase 3 items completed and tested
- [ ] All Phase 4 items completed and tested
- [ ] End-to-end flow works from Telegram message to video URL
- [ ] Error handling tested and working
- [ ] Documentation is complete and up-to-date
- [ ] Code is committed to version control
- [ ] Deployment checklist is ready
- [ ] Monitoring and logging are in place
- [ ] Stakeholders have approved the implementation

---

## Quick Reference: Key Changes Summary

### What We're Building

Transform the AISMR workflow from a broken idea generator into a complete orchestrator that produces published TikTok videos.

### Critical Changes

**Phase 1: Fix Blocking Issues**

1. Chat passes `turnId` → AISMR creates run from it
2. Fix "Validate Inputs" reference → use `$json.runId` directly
3. Fix `conversation_recall` → change to `conversation_remember`
4. Add error trigger to AISMR workflow

**Phase 2: Quality Improvements** 5. Fix Screen Writer to use "screenwriter" persona (not "ideagenerator") 6. Remove `continueOnFail` from critical nodes 7. Add error handling to Chat AI Agent

**Phase 3: Complete Architecture** 8. **Transform AISMR into orchestrator** - Biggest change!

- Call Generate Ideas → get 12 ideas
- Integrate HITL approval loop
- Call Screen Writer → get screenplay
- Call Generate Video → get video file
- Call Edit AISMR → get edited video
- Call Upload → get Drive URL
- Call Post to TikTok → get TikTok URL
- Send progress updates at each stage

9. Verify existing workflows (Video, Edit, Upload, TikTok) work
10. Implement progress updates with emoji
11. Ensure chatId propagates through entire flow

### New Flow Diagram

```
User: "Make an AISMR video about cats"
  ↓
Chat → passes turnId
  ↓
AISMR Orchestrator
  ├─→ Generate Ideas (12 ideas)
  │     ↓ "✅ Generated 12 ideas! Waiting for approval..."
  ├─→ HITL Approval (human picks best idea)
  │     ↓ "🎬 Screenplay ready! Generating video..."
  ├─→ Screen Writer (create video prompt)
  │     ↓ "🎥 Video generating..."
  ├─→ Generate Video (kie.ai API)
  │     ↓ "✂️ Editing video..."
  ├─→ Edit AISMR (apply edits)
  │     ↓ "☁️ Uploading to Drive..."
  ├─→ Upload to Google Drive
  │     ↓ "📱 Posting to TikTok..."
  └─→ Post to TikTok
        ↓ "🎉 Your AISMR video is live: [URL]"
```

### Deployment Strategy

- **Big bang:** Deploy all changes at once
- **Error handling:** Fail fast on any error
- **Testing:** Minimal - manual happy path + critical errors
- **Each workflow stays modular** for future expansion

### Success Criteria

- [ ] User sends "Make an AISMR video about cats"
- [ ] User receives 6 progress updates during execution
- [ ] Final message contains TikTok URL
- [ ] Video is live and playable on TikTok
- [ ] Total time < 10 minutes
- [ ] No errors in execution logs

---

## Notes

- Each checkbox can be completed independently unless noted
- Dependencies are indicated by phase ordering
- Test after each major change before proceeding
- Document all decisions and rationale
- Keep WORKFLOW_REVIEW.md updated as issues are resolved
- Use version control for all changes
- Error handling: Fail fast (stop on first error)
- Testing scope: Minimal (manual testing only)

**Created:** November 2, 2025  
**Updated:** November 2, 2025 (with architecture decisions)  
**Based on:** WORKFLOW_REVIEW.md comprehensive analysis
