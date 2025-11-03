# HITL Agent System Plan - Riley (Dual-Mode)

**Goal**: Create ONE workflow with TWO triggers that handles both request formatting AND response interpretation

**Riley's Job**:
- **Mode 1 (Request)**: Format content for user review → send to Telegram with buttons
- **Mode 2 (Response)**: Interpret user response → call HITL API → resume workflow

---

## Architecture

### Flow 1: Request Approval (Workflow → Telegram)
```
Original Workflow (generate-ideas)
      ↓
Execute: hitl-review.workflow (Mode 1)
  - Input: content to review, workflowRunId, stage
  - AI formats nice message
  - Sends to Telegram with ✅/❌ buttons
  - Exits (doesn't wait)
      ↓
User sees Telegram message
```

### Flow 2: Process Response (Telegram → Workflow)
```
User clicks button OR types response
      ↓
Telegram → Webhook: hitl-review.workflow (Mode 2)
  - Input: userMessage, approvalId, callbackData
  - AI determines approve vs reject
  - AI extracts feedback
  - Calls HITL API (approve/reject)
      ↓
HITL API updates DB
      ↓
Original workflow resumes (webhook)
```

---

## Phase 1: Update NotificationService with Inline Buttons (30 min)

### Modify `src/services/hitl/NotificationService.ts`

**Current** (line 110):
```typescript
const message = `${params.message}\n\nPlease reply with your decision to approve or reject this request.`;
```

**New** (add inline keyboard):
```typescript
const message = params.message;
const keyboard = {
  inline_keyboard: [[
    { text: '✅ Approve', callback_data: `approve:${approvalId}` },
    { text: '❌ Reject (reply to explain)', callback_data: `reject:${approvalId}` }
  ]]
};

await fetch(`https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: params.telegramChatId,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  }),
});
```

**Add parameters**:
- Pass `approvalId` to `notify()` method
- Update `NotifyParams` interface to include `approvalId?: string`

---

## Phase 2: Create HITL Agent Persona and Prompt (45 min)

### Create `prompts/personas/persona-hitl-reviewer.json`

```json
{
  "title": "HITL Review Agent",
  "memory": {
    "promptType": "persona",
    "type": "persona",
    "persona": ["hitl-reviewer"],
    "project": [],
    "tags": ["persona", "hitl", "reviewer", "approval"]
  },
  "agent": {
    "name": "Riley",
    "id": "hitl-reviewer",
    "title": "HITL Review Agent",
    "icon": "🔍✅"
  },
  "persona": {
    "role": "Human-in-the-Loop Review Interpreter",
    "voice": "Analytical and precise",
    "responsibilities": [
      "Analyze user responses to HITL approval requests",
      "Determine approval vs rejection intent",
      "Extract specific feedback and change requests",
      "Format responses for workflow consumption"
    ]
  },
  "workflow": {
    "inputs": [
      {
        "name": "userMessage",
        "description": "User's Telegram response (text or callback button)",
        "required": true
      },
      {
        "name": "approvalId",
        "description": "HITL approval ID",
        "required": true
      },
      {
        "name": "originalContent",
        "description": "The content being reviewed",
        "required": true
      }
    ],
    "steps": [
      {
        "order": 1,
        "name": "Analyze Intent",
        "instruction": "Determine if user is approving or rejecting. Look for positive indicators (yes, good, approve, looks great, LGTM, ✅) vs negative indicators (no, reject, change, fix, redo, ❌)."
      },
      {
        "order": 2,
        "name": "Extract Feedback",
        "instruction": "If rejecting, extract specific feedback: which items to change, what changes to make, why it's being rejected."
      },
      {
        "order": 3,
        "name": "Format Response",
        "instruction": "Return structured output with decision and actionable feedback."
      }
    ]
  },
  "output_schema": {
    "type": "object",
    "required": ["decision", "confidence", "feedback"],
    "properties": {
      "decision": {
        "type": "string",
        "enum": ["approve", "reject"],
        "description": "User's approval decision"
      },
      "confidence": {
        "type": "number",
        "description": "Confidence in the decision (0-1)"
      },
      "feedback": {
        "type": "object",
        "properties": {
          "summary": {
            "type": "string",
            "description": "Brief summary of user's feedback"
          },
          "specificChanges": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "item": {
                  "type": "string",
                  "description": "Which item to change (e.g., 'idea #3', 'the third one', 'velvet puppy')"
                },
                "change": {
                  "type": "string",
                  "description": "What change to make"
                }
              }
            }
          },
          "generalNotes": {
            "type": "string",
            "description": "Any general feedback or notes"
          }
        }
      }
    }
  }
}
```

---

## Phase 3: Create Dual-Mode HITL Workflow (90 min)

### Create `workflows/hitl-review.workflow.json`

**Two Triggers**:
1. **Execute Workflow Trigger** - Called by other workflows to REQUEST approval
2. **Webhook Trigger** - Called by Telegram to PROCESS user response

**Node Flow**:

### 1. Execute Workflow Trigger (Request Mode)
   - Inputs: `workflowRunId`, `stage`, `content`, `telegramChatId`, `projectId`
   - When this trigger fires → Request Mode

### 2. Webhook Trigger (Response Mode)
   - Path: `/webhook/hitl-response`
   - Method: POST
   - Body: `{ approvalId, userMessage, telegramChatId, callbackData }`
   - When this trigger fires → Response Mode

### 3. Detect Mode
   - If node: Check if `approvalId` is present
   - If present → Response Mode (process user answer)
   - If not present → Request Mode (send to user)

### 4A. REQUEST MODE Branch

**4A.1. Create HITL Approval Record**
   - HTTP Request: `POST /api/hitl/request-approval`
   - Body: `{ workflowRunId, stage, content }`
   - Returns: `{ approval: { id, ... } }`

**4A.2. Riley Formats Message (AI Agent)**
   - Persona: hitl-reviewer (request mode)
   - Input: content to review, projectId, stage
   - System Message:
     ```
     You are Riley, HITL review coordinator.
     
     Identity: persona="hitl-reviewer", project=null
     
     Goal: Format content for human review in Telegram.
     
     Input: Content that needs approval (ideas, screenplay, etc.)
     
     Task: Create a clear, concise message presenting the content for review.
     Include what the user is approving and any context they need.
     
     Output: Return a formatted message string suitable for Telegram (markdown).
     ```
   - Output: Formatted message string

**4A.3. Send to Telegram with Buttons**
   - Telegram node: Send message
   - Text: Riley's formatted message
   - Inline keyboard:
     ```json
     {
       "inline_keyboard": [[
         { "text": "✅ Approve", "callback_data": "approve:{{ approvalId }}" },
         { "text": "❌ Reject (type why)", "callback_data": "reject:{{ approvalId }}" }
       ]]
     }
     ```

**4A.4. Exit**
   - Return approval ID to calling workflow

### 4B. RESPONSE MODE Branch

**4B.1. Get Approval Details**
   - HTTP Request: `GET /api/hitl/approval/{{ approvalId }}`
   - Returns: approval content, workflowRunId, stage

**4B.2. Determine Response Type**
   - If node: Is it a callback (button click)?
   - Callback data format: "approve:abc-123" or "reject:abc-123"
   - If callback → Extract decision directly
   - If text message → Send to AI for interpretation

**4B.3. Riley Interprets Response (AI Agent - only if text)**
   - Persona: hitl-reviewer (response mode)
   - Input: userMessage, originalContent
   - System Message:
     ```
     You are Riley, HITL review interpreter.
     
     Identity: persona="hitl-reviewer", project=null
     
     Goal: Interpret user's response to determine approval/rejection and extract feedback.
     
     Input:
     - userMessage: What the user typed
     - originalContent: What they're reviewing
     
     Task: Determine if they're approving or rejecting.
     Extract specific feedback if rejecting (which items, what changes).
     
     Output: Return decision, confidence, and structured feedback.
     ```
   - Output Parser: Structured schema (decision, confidence, feedback)

**4B.4. Merge Decision**
   - Code node: Combine callback decision OR AI decision
   - Result: `{ decision, feedback, confidence }`

**4B.5. Route Decision**
   - If node: decision === 'approve' → Call Approve API
   - If node: decision === 'reject' → Call Reject API

**4B.6. Call HITL API**
   - Approve: `POST /api/hitl/approval/:approvalId/approve`
   - Reject: `POST /api/hitl/approval/:approvalId/reject`
   - Body includes feedback

**4B.7. Send Confirmation to Telegram**
   - Telegram node: Reply to user
   - Approve: "✅ Approved! Continuing workflow..."
   - Reject: "❌ Noted. Workflow will revise based on your feedback."

**4B.8. Return to Caller**
   - Return result (decision, feedback) via webhook response

---

## Phase 4: Configure Telegram Bot for Callbacks (15 min)

### Update Telegram Bot Settings

Telegram callback queries need a webhook URL configured with BotFather or via API:

```bash
curl -X POST https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://n8n.mjames.dev/webhook/telegram-callback",
    "allowed_updates": ["message", "callback_query"]
  }'
```

**Or** use Telegram Trigger node in n8n which automatically handles webhooks.

### Alternative: Telegram Trigger Node

Add a Telegram Trigger node to `hitl-review.workflow` that:
- Listens for ALL Telegram updates (messages + callback queries)
- Filters by chat ID (only authorized users)
- Routes callback_query → extract approvalId
- Routes text message → pass to AI

---

## Phase 5: Update Generate Ideas Workflow (20 min)

### Modify `workflows/generate-ideas.workflow.json`

**Change notification channel** (line 293):
```json
"notifyChannels": ["telegram"]  // Change from ['slack'] to ['telegram']
```

**Add telegramChatId to workflow run creation**:
- Extract from original run input
- Pass through to HITL request

**Replace polling loop** with webhook wait:
- Remove: "Wait Before Polling", "Get Approval Status", "Check Loop Limit"
- Add: "Wait for Webhook" node that pauses execution
- Webhook resumes workflow when approval complete

---

## Phase 6: Update HITLService to Include ApprovalId (15 min)

### Modify `src/services/hitl/HITLService.ts`

**Update notify call** (line 81-87):
```typescript
await this.notificationService.notify({
  channels,
  message: `🔔 *${params.stage} Approval Needed*\n\nProject: ${workflowRun.projectId}\n\nReview the content and reply to approve or reject.`,
  link: `/hitl/review/${approval.id}`,
  data: params.content,
  telegramChatId,
  approvalId: approval.id,  // ADD THIS
});
```

---

## Phase 7: Testing (30 min)

### Test Cases

1. **Inline button approve**
   - Click ✅ Approve
   - Verify workflow resumes
   - Verify approved status in DB

2. **Text approval variations**
   - "looks good!"
   - "approve"
   - "yes let's go"
   - "LGTM"
   - Verify all interpreted as approval

3. **Text rejection with feedback**
   - "reject - make the third one darker"
   - "no, change velvet puppy to crystal puppy"
   - "this doesn't work, try more cosmic vibes"
   - Verify rejection + feedback extraction

4. **Ambiguous responses**
   - "maybe"
   - "hmm not sure"
   - Check agent's confidence score

---

## File Changes Summary

### New Files
- `prompts/personas/persona-hitl-reviewer.json` - HITL agent persona
- `workflows/hitl-review.workflow.json` - Main HITL processing workflow
- `workflows/telegram-callback-handler.workflow.json` - Button click handler
- `schemas/hitl-review-output.schema.json` - HITL agent output schema

### Modified Files
- `src/services/hitl/NotificationService.ts` - Add inline keyboard buttons
- `src/services/hitl/HITLService.ts` - Pass approvalId to notify()
- `workflows/generate-ideas.workflow.json` - Use Telegram, webhook-based resume
- `workflows/screen-writer.workflow.json` - Same HITL pattern
- `scripts/injectSchemas.ts` - Add HITL schema mapping

---

## Success Criteria

- ✅ User receives Telegram message with ✅/❌ buttons
- ✅ User can click button for quick approve
- ✅ User can type any response (natural language)
- ✅ AI agent interprets intent correctly (>90% accuracy)
- ✅ Rejection feedback is extracted and actionable
- ✅ Workflow resumes automatically after approval/rejection
- ✅ System works at any workflow stage (idea_generation, screenplay, etc.)

---

**Estimated Time**: 3-4 hours total

**Ready to implement?**

