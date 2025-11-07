# Universal Workflow Pattern

V2 uses a **single universal workflow** (`myloware-agent.workflow.json`) that becomes any persona dynamically based on trace state. This eliminates the need for separate workflow files per agent.

---

## Overview

Instead of 6 separate workflows (one per persona), we have **one workflow** that:
- Accepts a `traceId` (or creates one from user messages)
- Queries the trace to discover which persona it should become
- Loads that persona's configuration and executes as that agent
- Hands off to the same workflow with a new traceId

**Key Benefits:**
- Zero duplication
- One template to maintain
- Add new persona = add config file (no workflow changes)
- Easy to test (one workflow to test)

---

## Workflow Structure

### 3-Node Pattern

Every execution follows this simple pattern:

```
┌─────────────────────────────────────┐
│  1. EDIT FIELDS NODE                │
│                                     │
│  • Extract traceId from input       │
│  • Pass through if present          │
│  • Set to null if missing           │
│                                     │
│  Output: { traceId?, input }        │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  2. TRACE_PREP (HTTP Request)       │
│                                     │
│  ONE call that does ALL:            │
│  • Creates trace if missing         │
│  • Loads trace.currentOwner         │
│  • Gets persona config              │
│  • Gets project config              │
│  • Searches memories by traceId     │
│  • Builds complete system prompt    │
│  • Returns allowed tools list       │
│                                     │
│  Output: { systemPrompt,            │
│            allowedTools,            │
│            traceId }                │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  3. AI AGENT NODE                   │
│                                     │
│  System Prompt: {{systemPrompt}}    │
│  MCP Tools: {{allowedTools}}       │
│                                     │
│  Agent:                             │
│  • Executes work                    │
│  • Calls memory_store               │
│  • Calls handoff_to_agent           │
│                                     │
│  (Handoff updates DB & triggers     │
│   SAME workflow via webhook)        │
└─────────────────────────────────────┘
```

---

## Node Configuration

### 1. Edit Fields Node

**Purpose:** Normalize inputs from all triggers (Telegram, Chat, Webhook)

**Configuration:**
```json
{
  "assignments": [
    {
      "id": "traceId",
      "name": "traceId",
      "value": "={{ $json.body?.traceId || $json.traceId || null }}",
      "type": "string"
    },
    {
      "id": "sessionId",
      "name": "sessionId",
      "value": "={{ $json.from?.id || $json.userId || $json.sessionId || $json.body.sessionId || 'telegram:' + ($json.message.chat.id || 'unknown') }}",
      "type": "string"
    },
    {
      "id": "message",
      "name": "message",
      "value": "={{ $json.message?.text || $json.chatInput || $json.body?.instructions || '' }}",
      "type": "string"
    },
    {
      "id": "source",
      "name": "source",
      "value": "={{ $json.message ? 'telegram' : ($json.chatInput ? 'chat' : 'webhook') }}",
      "type": "string"
    }
  ]
}
```

**Output:** Normalized object with `traceId`, `sessionId`, `message`, `source`

---

### 2. trace_prep HTTP Request Node

**Purpose:** Single preprocessing call that assembles everything

**Configuration:**
- **Method:** POST
- **URL:** `https://mcp-vector.mjames.dev/mcp/trace_prep` (hard-coded, n8n Cloud doesn't support `$env`)
- **Authentication:** Header Auth
  - Header Name: `X-API-Key`
  - Value: `mylo-mcp-bot` (from credentials)
- **Body:**
```json
{
  "traceId": "={{ $json.traceId }}",
  "sessionId": "={{ $json.sessionId }}",
  "instructions": "={{ $json.message }}",
  "source": "={{ $json.source }}"
}
```

**Response:**
```json
{
  "traceId": "trace-aismr-001",
  "systemPrompt": "You are Casey, the Showrunner...",
  "allowedTools": ["trace_update", "memory_search", "memory_store", "handoff_to_agent"],
  "instructions": "Make an AISMR video about candles",
  "memorySummary": "none logged yet (you will store the first entry)."
}
```

---

### 3. AI Agent Node

**Purpose:** Execute as the discovered persona

**Configuration:**
- **Model:** GPT-5 Nano (or configured model)
- **System Prompt:** `={{ $('Prepare Trace Context').item.json.systemPrompt }}`
- **User Message:** `={{ $('Prepare Trace Context').item.json.instructions }}`
- **MCP Client:** Connected to MCP server
  - **includeTools:** `={{ $('Prepare Trace Context').item.json.allowedTools }}` (dynamic scoping)

**Behavior:**
- Receives complete system prompt from trace_prep
- Has access only to tools in `allowedTools` array
- Executes work as that persona
- Calls `memory_store` to save outputs
- Calls `handoff_to_agent` when done

---

## Self-Referential Handoff Loop

When an agent calls `handoff_to_agent`:

```typescript
await handoff_to_agent({
  traceId: 'trace-aismr-001',
  toAgent: 'iggy',
  instructions: 'Generate 12 modifiers...'
});
```

**What happens:**
1. Tool updates trace: `currentOwner = "iggy"`, `workflowStep++`
2. Tool stores handoff memory tagged with traceId
3. Tool invokes webhook: `POST /webhook/myloware/ingest { traceId }`
4. **Same workflow** receives webhook
5. Edit Fields extracts traceId
6. trace_prep loads trace, finds `currentOwner = "iggy"`
7. trace_prep builds Iggy's prompt
8. AI Agent becomes Iggy
9. Loop continues...

**Key Insight:** The workflow is self-referential. It calls itself with different traceIds, becoming different personas each time.

---

## Persona Discovery

The workflow discovers which persona to become via `trace_prep`:

### First Call (No traceId)

```
User sends: "Make an AISMR video about candles"
  ↓
trace_prep (no traceId)
  ↓
Creates trace: currentOwner="casey", projectId="unknown"
  ↓
Loads persona: Casey
  ↓
Builds Casey init prompt (project selection mode)
  ↓
Returns: systemPrompt, allowedTools
  ↓
AI Agent becomes Casey
```

### Subsequent Calls (With traceId)

```
Webhook receives: { traceId: "trace-aismr-001" }
  ↓
trace_prep (with traceId)
  ↓
Loads trace: currentOwner="iggy"
  ↓
Loads persona: Iggy
  ↓
Loads project: AISMR
  ↓
Searches memories by traceId
  ↓
Builds Iggy prompt with context
  ↓
Returns: systemPrompt, allowedTools
  ↓
AI Agent becomes Iggy
```

---

## Tool Scoping

Each persona has different `allowedTools`:

**Casey:**
```json
{
  "allowedTools": [
    "trace_update",
    "memory_search",
    "memory_store",
    "handoff_to_agent"
  ]
}
```

**Iggy/Riley:**
```json
{
  "allowedTools": [
    "memory_search",
    "memory_store",
    "handoff_to_agent"
  ]
}
```

**Veo/Alex:**
```json
{
  "allowedTools": [
    "memory_search",
    "memory_store",
    "job_upsert",
    "jobs_summary",
    "handoff_to_agent"
  ]
}
```

**Quinn:**
```json
{
  "allowedTools": [
    "memory_search",
    "memory_store",
    "handoff_to_agent"
  ]
}
```

The MCP Client node filters tools dynamically:
```json
{
  "includeTools": "={{ $('Prepare Trace Context').item.json.allowedTools }}"
}
```

This ensures agents only see tools they're allowed to use.

---

## Troubleshooting

### Workflow Stuck

**Symptoms:** Trace stuck at one persona, no handoff happening

**Debug:**
1. Check trace status: `SELECT * FROM execution_traces WHERE trace_id = '...'`
2. Check if handoff was called: `SELECT * FROM memories WHERE metadata->>'traceId' = '...' AND 'handoff' = ANY(tags)`
3. Check webhook logs in n8n
4. Verify `handoff_to_agent` tool is in `allowedTools`

**Fix:**
- Ensure agent calls `handoff_to_agent` tool (not just stores memory)
- Verify webhook URL is correct
- Check n8n workflow is active

### Wrong Persona Executing

**Symptoms:** Workflow becomes wrong persona

**Debug:**
1. Check trace: `SELECT current_owner, workflow_step FROM execution_traces WHERE trace_id = '...'`
2. Verify `trace_prep` is loading correct persona
3. Check persona config in database

**Fix:**
- Verify `trace.currentOwner` matches expected persona
- Check persona exists in database
- Verify `trace_prep` is using correct `currentOwner`

### Tools Not Available

**Symptoms:** Agent can't call expected tool

**Debug:**
1. Check `allowedTools` in trace_prep response
2. Verify tool is in persona's `allowedTools` array
3. Check MCP Client `includeTools` configuration

**Fix:**
- Update persona's `allowedTools` in database
- Verify MCP Client is using dynamic `includeTools` expression
- Check tool is registered in MCP server

### Trace Not Found

**Symptoms:** `trace_prep` returns 404

**Debug:**
1. Verify traceId is correct UUID format
2. Check trace exists: `SELECT * FROM execution_traces WHERE trace_id = '...'`
3. Verify traceId is being passed correctly

**Fix:**
- Ensure traceId is valid UUID
- Check trace was created successfully
- Verify traceId is passed in webhook payload

---

## Configuration Checklist

When setting up the universal workflow:

- [ ] Three triggers configured (Telegram, Chat, Webhook)
- [ ] Edit Fields node normalizes all inputs
- [ ] trace_prep HTTP Request node configured with correct URL
- [ ] trace_prep authentication configured (X-API-Key header)
- [ ] AI Agent node uses dynamic systemPrompt from trace_prep
- [ ] MCP Client uses dynamic includeTools from trace_prep
- [ ] Webhook URL matches `handoff_to_agent` tool configuration
- [ ] All personas have `allowedTools` configured in database

---

## Related Documentation

- `docs/TRACE_STATE_MACHINE.md` - How trace ownership works
- `docs/ASYNC_PATTERNS.md` - How async operations work
- `docs/ARCHITECTURE.md` - Overall system architecture
- `workflows/myloware-agent.workflow.json` - Actual workflow file

