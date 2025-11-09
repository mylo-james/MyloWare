# Universal Workflow Pattern

V2 uses a **single universal workflow** (`myloware-agent.workflow.json`) that becomes any persona dynamically based on trace state. This eliminates the need for separate workflow files per agent.

---

## Overview

Instead of 6 separate workflows (one per persona), we have **one workflow** that:
- Accepts a `traceId` (or creates one from user messages)
- Queries the trace to discover which persona it should become
- Loads that persona's configuration and executes as that agent
- Hands off to the same workflow with a new traceId

> **Naming note:** The MCP tool is named `trace_prepare`, while the HTTP endpoint exposed to the workflow is `/mcp/trace_prep`. Use the tool name when discussing MCP contracts and the endpoint name when configuring n8n nodes.

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

**Response:** (proxied to the MCP tool `trace_prepare`)
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

## Tool Taxonomy

The system distinguishes between **MCP tools** (direct function calls) and **Workflow tools** (persona-restricted n8n workflows):

### Project Playbook Loading

When `/mcp/trace_prep` calls the `trace_prepare` MCP tool, it loads project playbooks from `data/projects/{projectName}/` before assembling the prompt:

- `workflow.json` supplies workflow overrides or additional metadata
- `guardrails.json` and the `guardrails/` directory contribute fine-grained constraints grouped by category
- `agent-expectations.json` adds persona-specific expectations or prompt templates
- `project.json` acts as a fallback when other files are absent

`loadProjectPlaybooks()` merges these artifacts with the project record, and `prepareTraceContext()` injects the merged guardrails and expectations directly into the system prompt that the AI agent receives.

### MCP Tools
- Direct function calls via MCP protocol
- Available to personas based on `allowedTools` configuration
- Examples: `memory_search`, `memory_store`, `trace_update`, `handoff_to_agent`, `jobs`, `workflow_trigger`

### Workflow Tools (Persona-Restricted)
- n8n workflows that execute complex operations
- **Restricted to specific personas** - other personas must hand off instead of calling directly
- Each workflow includes a guard that verifies the calling persona
- Examples:
  - `Workflow: Generate Video (Veo-only)` - Only Veo can call
  - `Workflow: Edit Compilation (Alex-only)` - Only Alex can call
  - `Workflow: Upload to TikTok (Quinn-only)` - Only Quinn can call
  - `Workflow: Upload to Drive (Quinn-only)` - Only Quinn can call

**Critical Rule:** Casey (and other non-owning personas) must **hand off to the owning persona** instead of calling workflow tools directly. The workflow guard will reject unauthorized calls and include the traceId in the error message.

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
- **MCP tools only** - Casey coordinates handoffs, never executes work
- Uses `trace_update` to set project
- Must hand off to the owning persona (Veo, Alex, Quinn) instead of calling workflows

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
- MCP tools for ideation/writing work
- No workflow tools - hand off to Veo/Alex/Quinn for execution

**Veo:**
```json
{
  "allowedTools": [
    "memory_search",
    "memory_store",
    "workflow_trigger",
    "jobs",
    "handoff_to_agent"
  ]
}
```
- Uses `jobs` for job tracking
- Uses `workflow_trigger({workflowKey: 'generate-video', ...})` to generate videos
- Must hand off to Alex for editing

**Alex:**
```json
{
  "allowedTools": [
    "memory_search",
    "memory_store",
    "workflow_trigger",
    "jobs",
    "handoff_to_agent"
  ]
}
```
- Uses `jobs` for job tracking
- Uses `workflow_trigger({workflowKey: 'edit-compilation', ...})` to edit compilations
- Must hand off to Quinn for publishing

**Quinn:**
```json
{
  "allowedTools": [
    "memory_search",
    "memory_store",
    "workflow_trigger",
    "handoff_to_agent"
  ]
}
```
- Uses `workflow_trigger({workflowKey: 'upload-to-tiktok', ...})` or `workflow_trigger({workflowKey: 'upload-to-drive', ...})` to publish
- Calls `handoff_to_agent({toAgent: 'complete'})` when done

The MCP Client node filters tools dynamically:
```json
{
  "includeTools": "={{ $('Prepare Trace Context').item.json.allowedTools }}"
}
```

This ensures agents only see MCP tools they're allowed to use. Workflow tools are available to all agents but guarded by persona verification nodes that reject unauthorized calls.

## North Star Flow

The canonical workflow order is: **Casey → Iggy → Riley → Veo → Alex → Quinn**

1. **Casey** (Showrunner): Identifies project, sets projectId, creates kickoff memory, hands off to Iggy
2. **Iggy** (Creative Director): Generates ideas/modifiers, stores in memory, seeks approval, hands off to Riley
3. **Riley** (Head Writer): Writes screenplays, validates specs, stores outputs, hands off to Veo
4. **Veo** (Production): Calls `Workflow: Generate Video (Veo-only)`, tracks jobs, stores URLs, hands off to Alex
5. **Alex** (Editor): Calls `Workflow: Edit Compilation (Alex-only)`, requests approval, stores final edit, hands off to Quinn
6. **Quinn** (Publisher): Calls `Workflow: Upload to TikTok (Quinn-only)` or `Workflow: Upload to Drive (Quinn-only)`, stores platform URLs, calls `handoff_to_agent({toAgent: 'complete'})`

**Key Principle:** Each persona executes their work autonomously and hands off directly to the next. Casey coordinates kickoff and completion, but doesn't micromanage the middle.

---

### Example Trace (AISMR Happy Path)

The Epic 2 test suite exercises this flow end-to-end with a real trace:
- `tests/e2e/full-aismr-happy-path.test.ts` verifies every handoff, memory write, and trace status transition completes in under 30 seconds (stubbed externals).
- `tests/integration/casey-iggy-handoff.test.ts` → `tests/integration/alex-quinn-handoff.test.ts` assert each pairwise handoff updates ownership, stores handoff memories, and loads the next persona’s playbook prompt.

Representative trace history (`traceId = trace-aismr-*`):

| Step | Persona | Stored Memory (persona/project) | Handoff Target |
|------|---------|---------------------------------|----------------|
| 0    | Casey   | Kickoff brief (`casey` / `aismr`) | Iggy           |
| 1    | Iggy    | 12 modifiers (`iggy` / `aismr`)   | Riley          |
| 2    | Riley   | 12 scripts (`riley` / `aismr`)    | Veo            |
| 3    | Veo     | 12 video URLs (`veo` / `aismr`)   | Alex           |
| 4    | Alex    | Final edit URL (`alex` / `aismr`) | Quinn          |
| 5    | Quinn   | Published URL (`quinn` / `aismr`) | `complete`     |

Every memory is tagged with the shared `traceId`, so downstream personas can load upstream work via `memory_search({ traceId })`.

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

