# HITL Agent System Plan

**Goal**: Create an AI agent that interprets Telegram responses to determine approval/rejection and extract feedback

**User Experience**:
- User receives HITL notification in Telegram (inline buttons OR text message)
- User can click ✅ Approve button OR type any response ("looks good!", "change the third one to be darker", "reject - too similar")
- HITL agent analyzes the response and:
  - Determines: approve vs reject
  - Extracts: which items to change and how
  - Sends: approval/rejection to workflow via API

---

## Architecture

```
Telegram User Response
      ↓
Telegram Webhook (n8n)
      ↓
HITL Agent Workflow (new)
  - AI analyzes intent
  - Extracts feedback
  - Calls HITL API
      ↓
HITL API (approve/reject)
      ↓
Resume Original Workflow
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

## Phase 3: Create HITL Agent n8n Workflow (60 min)

### Create `workflows/hitl-review.workflow.json`

**Trigger**: Webhook `/webhook/hitl-response/:approvalId`

**Nodes**:

1. **Webhook Trigger**
   - Path: `/webhook/hitl-response/:approvalId`
   - Method: POST
   - Receives: `{ userMessage, telegramChatId, callbackData }`

2. **Get Approval Details**
   - HTTP Request: `GET /api/hitl/approval/:approvalId`
   - Extract: approval content, workflowRunId, stage, projectId

3. **HITL Review Agent (AI)**
   - Persona: hitl-reviewer
   - System Message:
     ```
     You are Riley, HITL review interpreter.
     
     Identity: persona="hitl-reviewer", project=null
     
     Goal: Analyze user responses to determine approval/rejection and extract feedback.
     
     Bootstrap: Load your workflow and analyze the message.
     
     Input:
     - userMessage: User's Telegram response
     - originalContent: What they're reviewing
     
     Output: Return decision (approve/reject), confidence, and structured feedback.
     ```
   - Tools: MCP tools + prompt_get
   - Output Parser: Structured (using persona output_schema)

4. **Route Decision**
   - If node: decision === 'approve' → Approve branch
   - If node: decision === 'reject' → Reject branch

5. **Call Approve API** (approve branch)
   - HTTP Request: `POST /api/hitl/approval/:approvalId/approve`
   - Body:
     ```json
     {
       "reviewedBy": "telegram:{{ telegramChatId }}",
       "selectedItem": "{{ originalContent }}",
       "feedback": "{{ feedback.summary }}"
     }
     ```

6. **Call Reject API** (reject branch)
   - HTTP Request: `POST /api/hitl/approval/:approvalId/reject`
   - Body:
     ```json
     {
       "reviewedBy": "telegram:{{ telegramChatId }}",
       "reason": "{{ feedback.summary }}",
       "suggestedChanges": "{{ feedback.specificChanges }}"
     }
     ```

7. **Send Confirmation to Telegram**
   - Telegram node: Reply to user
   - Approve message: "✅ Approved! Continuing workflow..."
   - Reject message: "❌ Rejected. Workflow will retry with your feedback: {{ feedback.summary }}"

---

## Phase 4: Create Telegram Callback Handler Workflow (30 min)

### Create `workflows/telegram-callback-handler.workflow.json`

**Purpose**: Handle inline button clicks from Telegram

**Trigger**: Webhook that Telegram sends when user clicks inline button

**Nodes**:

1. **Telegram Callback Trigger**
   - Listens for Telegram callback queries
   - Extracts: `callback_data` (e.g., "approve:abc-123-def")

2. **Parse Callback Data**
   - Code node: Split `callback_data` into action and approvalId
   ```javascript
   const [action, approvalId] = $json.callback_query.data.split(':');
   ```

3. **Route Action**
   - If action === 'approve' → Call hitl-review workflow with "User approved via button"
   - If action === 'reject' → Ask for details in Telegram

4. **Trigger HITL Review Workflow**
   - Execute workflow: hitl-review
   - Pass: approvalId, userMessage (generated), telegramChatId

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

