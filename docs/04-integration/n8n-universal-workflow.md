# n8n Universal Workflow

**Audience:** n8n workflow operators, integration engineers  
**Outcome:** Understand and configure the universal workflow pattern

---

## Overview

MyloWare uses **one n8n workflow** (`myloware-agent.workflow.json`) that becomes any persona dynamically based on trace state.

**Key insight:** The workflow doesn't know which persona it is until runtime. It discovers its role from the trace.

---

## Official n8n Documentation

Use Context7 to fetch the latest n8n docs:

```
Context7: /n8n/n8n
```

This provides up-to-date information on:
- AI Agent node configuration
- MCP Client setup
- Webhook triggers
- Telegram "Send and Wait" nodes

The `docs/official-documentation/n8n.txt` file is a convenience snapshot but may be outdated.

---

## Workflow Structure

```
┌─────────────────────────────────────────────────┐
│  myloware-agent.workflow.json                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  1. Triggers (3 entry points)                   │
│     • Telegram                                  │
│     • Chat                                      │
│     • Webhook (/webhook/myloware/ingest)        │
│                                                 │
│  2. Edit Fields Node                            │
│     • Extract traceId from input                │
│     • Normalize to { traceId?, sessionId,       │
│       instructions, source }                    │
│                                                 │
│  3. trace_prep HTTP Request                     │
│     • POST /mcp/trace_prep                      │
│     • Creates trace if missing                  │
│     • Loads persona from trace.currentOwner     │
│     • Builds system prompt                      │
│     • Returns allowedTools                      │
│                                                 │
│  4. AI Agent Node                               │
│     • System Prompt: {{ prep.systemPrompt }}    │
│     • MCP Client with dynamic tools             │
│     • Executes as discovered persona            │
│                                                 │
│  5. Handoff (via tool call)                     │
│     • Agent calls handoff_to_agent              │
│     • Updates trace in database                 │
│     • Invokes SAME workflow via webhook         │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Node Configuration

### Edit Fields Node

**Type:** Set  
**Purpose:** Normalize inputs from all triggers

**Mappings:**
```javascript
{
  "traceId": "={{ $json.body?.traceId || $json.traceId || null }}",
  "sessionId": "={{ $json.sessionId || $json.body?.sessionId || 'chat:' + $now }}",
  "instructions": "={{ $json.message || $json.body?.instructions || $json.chatInput }}",
  "source": "={{ $json.source || $json.body?.source || 'webhook' }}"
}
```

### trace_prep HTTP Request

**Type:** HTTP Request  
**Method:** POST  
**URL:** `https://mcp-vector.mjames.dev/mcp/trace_prep`  
**Headers:**
```
Content-Type: application/json
X-API-Key: mylo-mcp-bot
```

**Body:**
```json
{
  "traceId": "={{ $json.traceId }}",
  "sessionId": "={{ $json.sessionId }}",
  "instructions": "={{ $json.instructions }}",
  "source": "={{ $json.source }}"
}
```

**Returns:**
- `systemPrompt` - Complete prompt for AI agent
- `allowedTools` - Tools scoped to persona
- `traceId` - Trace identifier
- `instructions` - Normalized instructions

### AI Agent Node

**Type:** @n8n/n8n-nodes-langchain.agent  
**Model:** gpt-4o-mini (or gpt-4-turbo for production)

**System Prompt:**
```
={{ $('trace_prep').item.json.systemPrompt }}
```

**MCP Client Configuration:**
- **URL:** `https://mcp-vector.mjames.dev/mcp`
- **Auth Header:** `X-API-Key`
- **API Key:** `mylo-mcp-bot`
- **Include Tools:** `={{ $('trace_prep').item.json.allowedTools }}`

**Key feature:** Tools are dynamically scoped per persona!

---

## Trigger Configuration

### Telegram Trigger

**Webhook URL:** Set in Telegram bot settings  
**Output:** `{ message, userId, chatId }`

### Chat Trigger

**Type:** LangChain Chat Trigger  
**Output:** `{ chatInput, sessionId }`

### Webhook Trigger

**Path:** `/webhook/myloware/ingest`  
**Method:** POST  
**Expected body:** `{ traceId, instructions?, metadata? }`

---

## HITL (Human-in-the-Loop)

Use Telegram "Send and Wait" nodes for approvals:

### Iggy Approval (After Ideas)

**Node:** Telegram - Send and Wait  
**Message:** "Here are 12 ideas: [list]. Approve?"  
**Buttons:** ["✅ Approve", "❌ Reject"]

**Branches:**
- Approved → Continue to handoff
- Rejected → Regenerate with feedback

### Alex Approval (After Editing)

**Node:** Telegram - Send and Wait  
**Message:** "Final edit ready: [preview]. Approve?"  
**Buttons:** ["✅ Publish", "❌ Revise"]

**Branches:**
- Approved → Handoff to Quinn
- Rejected → Regenerate with feedback

---

## Important Constraints

### No $env.* Placeholders

n8n Cloud does **not** support `$env.*` expressions in workflow JSON.

**Wrong:**
```json
{
  "url": "$env.MCP_BASE_URL/mcp"
}
```

**Correct:**
```json
{
  "url": "https://mcp-vector.mjames.dev/mcp"
}
```

Hard-code URLs or use credentials (not env vars).

---

## Handoff Pattern

When an agent calls `handoff_to_agent`:

1. Tool updates `execution_traces` table:
   - `currentOwner` = target agent
   - `workflowStep` = step + 1
   - `instructions` = new instructions

2. Tool invokes webhook:
   - `POST /webhook/myloware/ingest`
   - Body: `{ traceId }`

3. Same workflow receives webhook:
   - Calls `trace_prep` with `traceId`
   - Discovers new `currentOwner`
   - Becomes that persona

This creates a self-referential loop where one workflow handles all agents.

---

## Testing the Workflow

### Import to n8n

```bash
npm run import:workflows
```

### Trigger Test Run

```bash
curl -X POST http://localhost:5678/webhook/myloware/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "traceId": "test-trace-001"
  }'
```

### Monitor Execution

```bash
# Watch n8n logs
docker compose logs -f n8n

# Watch trace progress
psql $DATABASE_URL -c "
  SELECT current_owner, workflow_step, status 
  FROM execution_traces 
  WHERE trace_id = 'test-trace-001'
"
```

---

## Validation

✅ Workflow imports without errors  
✅ Webhook trigger is active  
✅ trace_prep returns valid response  
✅ AI Agent node receives systemPrompt  
✅ MCP Client has correct allowedTools  
✅ Handoff invokes webhook successfully

---

## Next Steps

- [MCP Integration](mcp-integration.md) - MCP protocol details
- [Telegram Setup](telegram-setup.md) - Bot configuration
- [Universal Workflow Architecture](../02-architecture/universal-workflow.md) - Design details

---

## Troubleshooting

**Workflow not becoming correct persona?**
- Check `trace.currentOwner` in database
- Verify `trace_prep` returns correct persona
- Check `allowedTools` matches persona config

**Handoff not triggering?**
- Verify webhook URL in `agent_webhooks` table
- Check webhook is active in n8n
- Verify `handoff_to_agent` tool is called (not just `memory_store`)

**MCP tools not available?**
- Verify MCP Client URL is correct
- Check API key matches
- Verify `allowedTools` array is populated

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

